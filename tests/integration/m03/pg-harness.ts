import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../db');

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const MAKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CHECKER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function migrateUp(): string {
  return execFileSync(
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

export function rolePassword(): string {
  return createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
}

export async function withAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function dropRoles(c: pg.Client, roles: readonly string[]): Promise<void> {
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
    [roles as unknown as string[]],
  );
  for (const role of roles) {
    const built = await c.query<{ s: string }>(
      `SELECT format(
         'DO $do$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
              DROP OWNED BY %I;
              DROP ROLE %I;
            END IF;
          END $do$',
         $1::text, $1::text, $1::text
       ) AS s`,
      [role],
    );
    await c.query(built.rows[0]?.s ?? '');
  }
}

export async function createLogin(c: pg.Client, role: string, inherit: string, password: string) {
  const created = await c.query<{ s: string }>(
    `SELECT format(
       'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, %I',
       $1::text, $2::text, $3::text
     ) AS s`,
    [role, password, inherit],
  );
  await c.query(created.rows[0]?.s ?? '');
}

export function runtimePool(role: string, password: string, max = 4): pg.Pool {
  const parsed = new URL(adminUrl());
  return new pg.Pool({
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: role,
    password,
    max,
  });
}

export async function asTenant<T>(
  pool: pg.Pool,
  tenant: string | null,
  actor: string,
  fn: (c: pg.PoolClient) => Promise<T>,
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
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
