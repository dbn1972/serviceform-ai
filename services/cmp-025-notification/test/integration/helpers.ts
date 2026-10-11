import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlPool } from '../../src/repo/pg.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_DIR = join(REPO_ROOT, 'db');
const requireFromDb = createRequire(join(DB_DIR, 'package.json'));

/** CMP-025 pair only. Isolated reversibility must not assume these are the global tip. */
export const CMP025_MIGRATION_FILES = [
  '1759545025000_cmp-025-notification.sql',
  '1759545025001_cmp-025-outbox.sql',
] as const;

export const CMP025_MIGRATION_NAMES = CMP025_MIGRATION_FILES.map((f) => f.replace(/\.sql$/, ''));

/**
 * Platform prerequisites of the CMP-025 pair: sf_app (baseline), sf_platform.current_tenant_id()
 * and sf_outbox_publisher (shared DB contracts). The pair creates sf_migrator / sf_cmp025_rw itself.
 */
const CMP025_ISOLATED_CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...CMP025_MIGRATION_FILES,
] as const;

export interface PgClientLike {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (config: Record<string, unknown>) => PgPoolLike;
  Client: new (config: Record<string, unknown>) => {
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
  };
}
const pg = requireFromDb('pg') as PgModule;

const TEST_LOGIN_ROLES = ['sf_t025_rt', 'sf_t025_other'] as const;

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '99999999-9999-4999-8999-999999999999';
export const OFFICER = '33333333-3333-4333-8333-333333333333';
export const CANARY = 'CANARY-T2-NTF-7a2e41';

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function migrate(): void {
  execFileSync(
    'pnpm',
    [
      'exec',
      'node-pg-migrate',
      'up',
      '--migrations-dir',
      'migrations',
      '--migrations-table',
      'sf_schema_migrations',
      '--migrations-schema',
      'sf_platform',
      '--create-migrations-schema',
      '--check-order',
    ],
    { cwd: DB_DIR, encoding: 'utf8', env: process.env },
  );
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

/**
 * Tip-count `down N` on the combined catalog is unsafe once sibling migrations sort after
 * CMP-025 (e.g. CMP-020 tip after STITCH-A). Prefer {@link withIsolatedCmp025Database}.
 */
export function migrateDown(count: number): void {
  runMigrate('migrations', process.env, 'down', count);
}

export interface CombinedCatalogSnapshot {
  migrationNames: string[];
  notificationPresent: boolean;
  feePresent: boolean;
  feeTables: string[];
}

/** Snapshot used to prove CMP-025 isolated reversibility does not tear down sibling tips. */
export async function snapshotCombinedCatalog(
  admin: Pick<PgPoolLike, 'query'>,
): Promise<CombinedCatalogSnapshot> {
  const migrations = await admin.query(
    'SELECT name FROM sf_platform.sf_schema_migrations ORDER BY name',
  );
  const notification = await admin.query(
    `SELECT 1 FROM pg_namespace WHERE nspname = 'sf_notification'`,
  );
  const fee = await admin.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_fee'`);
  const feeTables = await admin.query(
    `SELECT c.relname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'sf_fee' AND c.relkind = 'r'
      ORDER BY 1`,
  );
  return {
    migrationNames: migrations.rows.map((r) => String(r['name'])),
    notificationPresent: notification.rows.length > 0,
    feePresent: fee.rows.length > 0,
    feeTables: feeTables.rows.map((r) => String(r['relname'])),
  };
}

/**
 * Throwaway database whose migration directory holds only CMP025_ISOLATED_CHAIN, so `down 2`
 * reverses exactly the named CMP-025 pair whatever sorts after it in the combined chain.
 */
export async function withIsolatedCmp025Database<T>(
  admin: PgPoolLike,
  fn: (
    iso: InstanceType<PgModule['Client']>,
    migrateIso: (direction: 'up' | 'down', count?: number) => string,
  ) => Promise<T>,
): Promise<T> {
  const name = `sf_cmp025_rev_${randomBytes(4).toString('hex')}`;
  if (!/^sf_cmp025_rev_[0-9a-f]{8}$/.test(name)) {
    throw new Error('isolated database name failed allowlist');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'cmp025-rev-'));
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${name}`;
  const isoUrl = parsed.toString();
  const isoEnv = { ...process.env, DATABASE_URL: isoUrl };
  const createSql = `CREATE DATABASE ${name} TEMPLATE template0`;
  const dropSql = `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`;
  try {
    for (const file of CMP025_ISOLATED_CHAIN) {
      copyFileSync(join(DB_DIR, 'migrations', file), join(tmp, file));
    }
    await admin.query(createSql);
    const iso = new pg.Client({ connectionString: isoUrl });
    await iso.connect();
    try {
      return await fn(iso, (direction, count) => runMigrate(tmp, isoEnv, direction, count));
    } finally {
      await iso.end();
    }
  } finally {
    try {
      await admin.query(dropSql);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

async function withAdmin<T>(fn: (c: InstanceType<PgModule['Client']>) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function execFormatted(
  c: InstanceType<PgModule['Client']>,
  template: string,
  arg: string,
): Promise<void> {
  const built = await c.query('SELECT format($1::text, $2::text) AS s', [template, arg]);
  await c.query(String(built.rows[0]?.['s'] ?? ''));
}

export interface Harness {
  admin: PgPoolLike;
  rt: PgPoolLike;
  other: PgPoolLike;
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  await withAdmin(async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
      [TEST_LOGIN_ROLES as unknown as string[]],
    );
    for (const role of TEST_LOGIN_ROLES) {
      await execFormatted(
        c,
        `DO $do$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%1$s') THEN
             EXECUTE 'DROP OWNED BY %1$s'; EXECUTE 'DROP ROLE %1$s';
           END IF;
         END $do$`,
        role,
      );
    }
  });
  migrate();
  await withAdmin(async (c) => {
    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
          CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await c.query(`
      TRUNCATE TABLE sf_notification.dispatch_attempt, sf_notification.notification_dispatch,
        sf_notification.notification_template, sf_notification.idempotency_record,
        sf_notification.outbox_event, sf_notification.outbox_event_platform,
        sf_notification.inbox_event, sf_notification.inbox_event_platform RESTART IDENTITY CASCADE
    `);
    await execFormatted(
      c,
      'CREATE ROLE sf_t025_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp025_rw',
      password,
    );
    await execFormatted(
      c,
      'CREATE ROLE sf_t025_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw',
      password,
    );
  });
  const parsed = new URL(adminUrl());
  const pool = (user: string, max: number): PgPoolLike =>
    new pg.Pool({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user,
      password,
      max,
    });
  return {
    admin: new pg.Pool({ connectionString: adminUrl(), max: 2 }),
    rt: pool('sf_t025_rt', 6),
    other: pool('sf_t025_other', 2),
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.other.end()]);
}

export function asSqlPool(pool: PgPoolLike): SqlPool {
  return pool as unknown as SqlPool;
}

export async function asTenant<T>(
  pool: PgPoolLike,
  tenant: string | null,
  actor: string,
  fn: (c: PgClientLike) => Promise<T>,
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
