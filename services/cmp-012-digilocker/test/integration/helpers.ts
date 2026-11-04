import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlPool } from '../../src/repo/pg.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_DIR = join(REPO_ROOT, 'db');
const requireFromDb = createRequire(join(DB_DIR, 'package.json'));

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

const TEST_LOGIN_ROLES = ['sf_t012_rt', 'sf_t012_peer', 'sf_t012_app'] as const;

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
      '--create-migrations-schema',
      '--migrations-dir',
      'migrations',
      '--migrations-table',
      'sf_schema_migrations',
      '--migrations-schema',
      'sf_platform',
      '--check-order',
    ],
    { cwd: DB_DIR, encoding: 'utf8', env: process.env },
  );
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
  /** sf_app + sf_cmp012_rw: the CMP-012 runtime login (ADR-0006). */
  rt: PgPoolLike;
  /** sf_app + sf_cmp022_rw: a peer component's runtime login. */
  peer: PgPoolLike;
  /** sf_app only, without any component write role. */
  appOnly: PgPoolLike;
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
      TRUNCATE TABLE sf_digilocker.publish_record, sf_digilocker.idempotency_record,
        sf_digilocker.outbox_event, sf_digilocker.outbox_event_platform,
        sf_digilocker.inbox_event, sf_digilocker.inbox_event_platform RESTART IDENTITY CASCADE
    `);
    await execFormatted(
      c,
      'CREATE ROLE sf_t012_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp012_rw',
      password,
    );
    await execFormatted(
      c,
      'CREATE ROLE sf_t012_peer LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp022_rw',
      password,
    );
    await execFormatted(
      c,
      'CREATE ROLE sf_t012_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app',
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
    rt: pool('sf_t012_rt', 6),
    peer: pool('sf_t012_peer', 2),
    appOnly: pool('sf_t012_app', 2),
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.peer.end(), h.appOnly.end()]);
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
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_type', 'SYSTEM']);
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

export async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? `error:${String(e)}`;
  }
}
