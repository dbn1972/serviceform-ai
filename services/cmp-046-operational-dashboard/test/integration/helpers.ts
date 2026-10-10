import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlPool } from '../../src/repo/pg.js';

/**
 * PostgreSQL harness. The driver is resolved through @serviceform/db so this component declares
 * no runtime dependency. Runtime access uses real LOGIN roles (ADR-0006 condition 10).
 */
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

export const RUNTIME_ROLE = 'sf_t046_rt';
export const PEER_ROLE = 'sf_t046_peer';
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '99999999-9999-4999-8999-999999999999';
export const OFFICER = '33333333-3333-4333-8333-333333333333';

export const MIGRATION_FILES = [
  '1759542460000_cmp-046-operational-dashboard.sql',
  '1759542460001_cmp-046-outbox.sql',
];
/** Platform prerequisites of the CMP-046 pair (sf_app, sf_platform.current_tenant_id, publisher). */
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

/** The combined chain is `up` only: later migrations may sort after CMP-046. */
export function migrateUp(): string {
  return runMigrate('migrations', process.env, 'up');
}

export interface IsolatedDatabase {
  name: string;
}

/**
 * Throwaway database holding only ISOLATED_CHAIN, so `down 2` reverses exactly the CMP-046 pair
 * whatever sorts after it in the combined chain. Database and temp directory are released on
 * every path.
 */
export async function withIsolatedDatabase<T>(
  admin: PgPool,
  fn: (
    iso: PgConnection,
    migrateIso: (direction: 'up' | 'down', count?: number) => string,
    info: IsolatedDatabase,
  ) => Promise<T>,
): Promise<T> {
  const name = `sf_cmp046_rev_${randomBytes(4).toString('hex')}`;
  if (!/^sf_cmp046_rev_[0-9a-f]{8}$/.test(name))
    throw new Error('isolated database name failed allowlist');
  const tmp = mkdtempSync(join(tmpdir(), 'cmp046-rev-'));
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${name}`;
  const isoUrl = parsed.toString();
  const isoEnv = { ...process.env, DATABASE_URL: isoUrl };
  try {
    for (const file of ISOLATED_CHAIN)
      copyFileSync(join(DB_DIR, 'migrations', file), join(tmp, file));
    const createSql = `CREATE DATABASE ${name} TEMPLATE template0`;
    await admin.query(createSql);
    const iso = new pg.Client({ connectionString: isoUrl });
    await iso.connect();
    try {
      return await fn(iso, (direction, count) => runMigrate(tmp, isoEnv, direction, count), {
        name,
      });
    } finally {
      await iso.end();
    }
  } finally {
    const dropSql = `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`;
    try {
      await admin.query(dropSql);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

export interface Harness {
  admin: PgPool;
  rt: PgPool;
  peer: PgPool;
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

export async function resetData(admin: PgPool): Promise<void> {
  await admin.query(`
    TRUNCATE sf_ops_dashboard.ops_view_refresh_log, sf_ops_dashboard.ops_view_snapshot,
      sf_ops_dashboard.idempotency_record, sf_ops_dashboard.outbox_event,
      sf_ops_dashboard.outbox_event_platform, sf_ops_dashboard.inbox_event,
      sf_ops_dashboard.inbox_event_platform RESTART IDENTITY CASCADE
  `);
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  const admin = new pg.Pool({ connectionString: adminUrl(), max: 3 });
  await dropLoginRoles(admin);
  migrateUp();
  await resetData(admin);
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
        CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
  `);
  for (const [role, member] of [
    [RUNTIME_ROLE, 'sf_cmp046_rw'],
    [PEER_ROLE, 'sf_cmp048_rw'],
  ] as const) {
    const stmt = await admin.query<{ s: string }>(
      `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, %I', $1::text, $2::text, $3::text) AS s`,
      [role, password, member],
    );
    await admin.query(stmt.rows[0]?.s ?? '');
  }
  const parsed = new URL(adminUrl());
  const pool = (user: string, max: number): PgPool => {
    const created = new pg.Pool({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user,
      password,
      max,
    });
    // Teardown terminates the login role's sessions; an idle-client error then is expected.
    created.on('error', () => undefined);
    return created;
  };
  return { admin, rt: pool(RUNTIME_ROLE, 6), peer: pool(PEER_ROLE, 2) };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.rt.end(), h.peer.end()]);
  await dropLoginRoles(h.admin);
  await h.admin.end();
}

export function asSqlPool(pool: PgPool): SqlPool {
  return pool as unknown as SqlPool;
}

export async function asTenant<T>(
  pool: PgPool,
  tenant: string | null,
  actor: string,
  fn: (c: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenant) await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', actor]);
    await client.query('SELECT set_config($1, $2, true)', ['app.cell_id', 'cell-01']);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_type', 'OFFICER']);
    await client.query('SELECT set_config($1, $2, true)', ['app.correlation_id', randomUUID()]);
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
