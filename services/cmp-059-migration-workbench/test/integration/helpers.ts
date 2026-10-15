import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_DIR = join(REPO_ROOT, 'db');
const requireFromDb = createRequire(join(DB_DIR, 'package.json'));

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}
export interface PgClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  release(): void;
}
export interface PgPool {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}
export interface PgConnection {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<void>;
  end(): Promise<void>;
}
const pg = requireFromDb('pg') as {
  Pool: new (cfg: object) => PgPool;
  Client: new (cfg: object) => PgConnection;
};

export const RUNTIME_ROLE = 'sf_t059_rt';
export const PEER_ROLE = 'sf_t059_peer';
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '99999999-9999-4999-8999-999999999999';
export const OFFICER = '33333333-3333-4333-8333-333333333333';

export const MIGRATION_FILES = ['1761100000000_cmp-059-migration-workbench.sql'];
export const ISOLATED_CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...MIGRATION_FILES,
];

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

function runMigrate(
  migrationsDir: string,
  env: NodeJS.ProcessEnv,
  direction: 'up' | 'down',
  count?: number,
): string {
  return execFileSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      direction,
      ...(count === undefined ? [] : [String(count)]),
      '--migrations-dir',
      migrationsDir,
      '--migrations-table',
      'sf_schema_migrations',
      '--migrations-schema',
      'sf_platform',
      '--create-migrations-schema',
      '--check-order',
    ],
    { cwd: DB_DIR, encoding: 'utf8', env },
  );
}

export async function withIsolatedDatabase<T>(
  admin: PgPool,
  fn: (
    iso: PgConnection,
    migrateIso: (direction: 'up' | 'down', count?: number) => string,
    info: { name: string; url: string },
  ) => Promise<T>,
): Promise<T> {
  const name = `sf_cmp059_rev_${randomBytes(4).toString('hex')}`;
  const tmp = mkdtempSync(join(tmpdir(), 'cmp059-rev-'));
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${name}`;
  const isoUrl = parsed.toString();
  const isoEnv = { ...process.env, DATABASE_URL: isoUrl };
  try {
    for (const file of ISOLATED_CHAIN)
      copyFileSync(join(DB_DIR, 'migrations', file), join(tmp, file));
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
    const iso = new pg.Client({ connectionString: isoUrl });
    await iso.connect();
    try {
      return await fn(iso, (direction, count) => runMigrate(tmp, isoEnv, direction, count), {
        name,
        url: isoUrl,
      });
    } finally {
      await iso.end();
    }
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

export interface Harness {
  admin: PgPool;
  rt: PgPool;
  peer: PgPool;
  dbName: string;
  password: string;
}

async function dropLoginRoles(admin: PgPool): Promise<void> {
  for (const role of [RUNTIME_ROLE, PEER_ROLE]) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()',
      [role],
    );
    const stmt = await admin.query<{ s: string }>(
      `SELECT format('DO $do$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
         DROP OWNED BY %I; DROP ROLE %I; END IF; END $do$', $1::text, $1::text, $1::text) AS s`,
      [role],
    );
    await admin.query(stmt.rows[0]?.s ?? '');
  }
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  const admin = new pg.Pool({ connectionString: adminUrl(), max: 3 });
  await dropLoginRoles(admin);

  const dbName = `sf_m09_004_${randomBytes(3).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${dbName}`;
  const dbUrl = parsed.toString();
  const env = { ...process.env, DATABASE_URL: dbUrl };
  const tmp = mkdtempSync(join(tmpdir(), 'cmp059-h-'));
  try {
    for (const file of ISOLATED_CHAIN)
      copyFileSync(join(DB_DIR, 'migrations', file), join(tmp, file));
    runMigrate(tmp, env, 'up');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const setup = new pg.Client({ connectionString: dbUrl });
  await setup.connect();
  try {
    // Peer inherits a different privilege role so DML on sf_migration is denied.
    await setup.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp058_rw') THEN
          CREATE ROLE sf_cmp058_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;
    `);
    for (const [role, member] of [
      [RUNTIME_ROLE, 'sf_cmp059_rw'],
      [PEER_ROLE, 'sf_cmp058_rw'],
    ] as const) {
      const stmt = await setup.query<{ s: string }>(
        `SELECT format(
           'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, %I',
           $1::text, $2::text, $3::text
         ) AS s`,
        [role, password, member],
      );
      await setup.query(stmt.rows[0]?.s ?? '');
    }
    await setup.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${RUNTIME_ROLE}, ${PEER_ROLE}`);
  } finally {
    await setup.end();
  }

  const poolFor = (user: string, max: number): PgPool => {
    const created = new pg.Pool({
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || 5432),
      database: dbName,
      user,
      password,
      max,
    });
    created.on('error', () => undefined);
    return created;
  };

  return {
    admin: new pg.Pool({ connectionString: dbUrl, max: 3 }),
    rt: poolFor(RUNTIME_ROLE, 6),
    peer: poolFor(PEER_ROLE, 2),
    dbName,
    password,
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.rt.end(), h.peer.end()]);
  await dropLoginRoles(h.admin);
  await h.admin.end();
  const root = new pg.Pool({ connectionString: adminUrl(), max: 1 });
  try {
    await root.query(`DROP DATABASE IF EXISTS ${h.dbName} WITH (FORCE)`);
  } finally {
    await root.end();
  }
}

export async function resetData(admin: PgPool): Promise<void> {
  await admin.query(`
    TRUNCATE
      sf_migration.reconciliation_result,
      sf_migration.cutover_manifest,
      sf_migration.migration_batch,
      sf_migration.mapping_spec,
      sf_migration.source_profile,
      sf_migration.idempotency_record,
      sf_migration.migration_project,
      sf_migration.outbox_event
    RESTART IDENTITY CASCADE
  `);
}

export async function asTenant<T>(
  pool: PgPool,
  tenant: string,
  fn: (c: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['sf.tenant_id', tenant]);
    await client.query('SELECT set_config($1, $2, true)', ['sf.actor_id', OFFICER]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // keep original
    }
    throw e;
  } finally {
    client.release();
  }
}

export { randomUUID, withIsolatedDatabase as withIsolatedDb };
