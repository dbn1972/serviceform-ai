import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { RequestContext } from '@serviceform/contracts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_DIR = join(ROOT, 'db');

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const ACTOR = '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function migrate(direction: 'up' | 'down', count?: number): string {
  const args = [
    'node-pg-migrate',
    direction,
    ...(count === undefined ? [] : [String(count)]),
    '--migrations-dir',
    'migrations',
    '--migrations-table',
    'sf_schema_migrations',
    '--migrations-schema',
    'sf_platform',
    '--create-migrations-schema',
  ];
  return execFileSync('pnpm', ['exec', ...args], {
    cwd: DB_DIR,
    encoding: 'utf8',
    env: process.env,
  });
}

export function officerCtx(tenant: string | null): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: ACTOR },
    roles: ['AUDITOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: TRACE,
  };
}

export function systemCtx(tenant: string | null): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'SYSTEM', id: ACTOR },
    roles: ['WORKLOAD'],
    jurisdiction_ids: [],
    auth_assurance: 'WORKLOAD_IDENTITY',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: TRACE,
  };
}

export interface Harness {
  admin: pg.Pool;
  writer: pg.Pool;
  rt: pg.Pool;
  writerUrl: string;
  writerName: string;
  rtName: string;
}

const WRITER = 'sf_t003_writer';
const RT = 'sf_t003_rt';

function syntheticTestPassword(label: string): string {
  return `SF-TEST-ONLY-synthetic-${label}-${randomBytes(16).toString('hex')}`;
}

async function createLoginRole(admin: pg.Pool, name: string, password: string): Promise<void> {
  const built = await admin.query<{ sql: string }>(
    `SELECT format(
       'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT',
       $1,
       $2
     ) AS sql`,
    [name, password],
  );
  const sql = built.rows[0]?.sql;
  if (sql === undefined) throw new Error('role ddl missing');
  await admin.query(sql);
}

export async function createHarness(): Promise<Harness> {
  migrate('up');
  const admin = new pg.Pool({ connectionString: databaseUrl(), max: 4 });
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp002_rw') THEN
        CREATE ROLE sf_cmp002_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp037_rw') THEN
        CREATE ROLE sf_cmp037_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw') THEN
        CREATE ROLE sf_cmp038_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
        CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename IN ('sf_t003_writer', 'sf_t003_rt') AND pid <> pg_backend_pid()`,
  );
  await admin.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t003_writer') THEN
        DROP OWNED BY sf_t003_writer;
        DROP ROLE sf_t003_writer;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_t003_rt') THEN
        DROP OWNED BY sf_t003_rt;
        DROP ROLE sf_t003_rt;
      END IF;
    END $$;
  `);
  const writerPassword = syntheticTestPassword('writer');
  const rtPassword = syntheticTestPassword('rt');
  await createLoginRole(admin, WRITER, writerPassword);
  await createLoginRole(admin, RT, rtPassword);
  await admin.query('GRANT sf_app TO sf_t003_writer');
  await admin.query('GRANT sf_cmp031_rw TO sf_t003_writer');
  await admin.query('GRANT sf_app TO sf_t003_rt');
  const dbname = (await admin.query<{ current_database: string }>('SELECT current_database()'))
    .rows[0]?.current_database;
  if (dbname === undefined) throw new Error('current_database missing');
  const ident = '"' + dbname.replaceAll('"', '""') + '"';
  await admin.query('GRANT CONNECT ON DATABASE ' + ident + ' TO sf_t003_writer, sf_t003_rt');
  const parsed = new URL(databaseUrl());
  const writerUrl = roleUrl(parsed, WRITER, writerPassword);
  const rtUrl = roleUrl(parsed, RT, rtPassword);
  const writer = new pg.Pool({ connectionString: writerUrl, max: 8 });
  const rt = new pg.Pool({ connectionString: rtUrl, max: 4 });
  return { admin, writer, rt, writerUrl, writerName: WRITER, rtName: RT };
}

function roleUrl(base: URL, user: string, secret: string): string {
  const host = base.host;
  const path = `${base.pathname}${base.search}${base.hash}`;
  return `${base.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(secret)}@${host}${path}`;
}

export async function asWriter<T>(
  pool: pg.Pool,
  ctx: RequestContext,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (ctx.tenant_id)
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenant_id]);
    await c.query(`SELECT set_config('app.cell_id', $1, true)`, [ctx.cell_id]);
    await c.query(`SELECT set_config('app.actor_type', $1, true)`, [ctx.actor.type]);
    await c.query(`SELECT set_config('app.actor_id', $1, true)`, [ctx.actor.id]);
    await c.query(`SELECT set_config('app.correlation_id', $1, true)`, [ctx.correlation_id]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

export async function closeHarness(h: Harness): Promise<void> {
  await h.writer.end();
  await h.rt.end();
  await h.admin.end();
}
