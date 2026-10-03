import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL required');
  return url;
}

export function migrate(direction: 'up' | 'down', count?: number): void {
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
  execFileSync('pnpm', ['exec', ...args], {
    cwd: join(ROOT, 'db'),
    env: process.env,
    stdio: 'pipe',
  });
}

export async function adminClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: adminUrl() });
  await c.connect();
  return c;
}

export function runtimeUrl(user: string, password: string): string {
  const u = new URL(adminUrl());
  u.username = user;
  u.password = password;
  return u.toString();
}

export async function createLogins(): Promise<{
  rt: pg.Pool;
  other: pg.Pool;
  password: string;
}> {
  const password = `t${randomBytes(12).toString('hex')}`;
  const admin = await adminClient();
  try {
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp002_rw') THEN
          CREATE ROLE sf_cmp002_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp031_rw') THEN
          CREATE ROLE sf_cmp031_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp037_rw') THEN
          CREATE ROLE sf_cmp037_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp038_rw') THEN
          CREATE ROLE sf_cmp038_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;`);
    await admin.query('DROP ROLE IF EXISTS sf_cmp048_rt');
    await admin.query('DROP ROLE IF EXISTS sf_other_rt');
    const mkRt =
      "CREATE ROLE sf_cmp048_rt LOGIN PASSWORD '" +
      password +
      "' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT IN ROLE sf_app, sf_cmp048_rw";
    const mkOther =
      "CREATE ROLE sf_other_rt LOGIN PASSWORD '" +
      password +
      "' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT IN ROLE sf_app";
    await admin.query(mkRt);
    await admin.query(mkOther);
  } finally {
    await admin.end();
  }
  return {
    password,
    rt: new pg.Pool({ connectionString: runtimeUrl('sf_cmp048_rt', password), max: 1 }),
    other: new pg.Pool({ connectionString: runtimeUrl('sf_other_rt', password), max: 1 }),
  };
}

export async function dropLogins(rt: pg.Pool, other: pg.Pool): Promise<void> {
  await rt.end();
  await other.end();
  const admin = await adminClient();
  try {
    await admin.query('DROP ROLE IF EXISTS sf_cmp048_rt');
    await admin.query('DROP ROLE IF EXISTS sf_other_rt');
  } finally {
    await admin.end();
  }
}

export async function expectPgError(
  c: pg.PoolClient,
  fn: () => Promise<unknown>,
): Promise<{ code?: string; message: string }> {
  await c.query('SAVEPOINT sf_expect');
  try {
    await fn();
    await c.query('RELEASE SAVEPOINT sf_expect');
    throw new Error('expected query to fail');
  } catch (err) {
    if (err instanceof Error && err.message === 'expected query to fail') {
      throw err;
    }
    await c.query('ROLLBACK TO SAVEPOINT sf_expect');
    const e = err as { code?: string; message: string };
    if (e.code) return { code: e.code, message: e.message };
    return { message: e.message };
  }
}

export async function asTenant<T>(
  pool: pg.Pool,
  tenant: string | null,
  actor: string,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (tenant) await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
    await c.query('SELECT set_config($1, $2, true)', ['app.actor_id', actor]);
    await c.query('SELECT set_config($1, $2, true)', ['app.cell_id', 'cell-01']);
    await c.query('SELECT set_config($1, $2, true)', ['app.actor_type', 'OFFICER']);
    await c.query('SELECT set_config($1, $2, true)', [
      'app.correlation_id',
      '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    ]);
    const out = await fn(c);
    await c.query('ROLLBACK');
    return out;
  } catch (err) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    c.release();
  }
}

export function startOpa(opts: {
  pepToken: string;
  grantToken: string;
  port: number;
}): ChildProcess {
  const policy = join(ROOT, 'policy/opa');
  // Ignore .manifest so this is a directory load (data.sf.common + system.authz),
  // not a bundle whose roots omit system/authz.
  const child = spawn(
    process.env['OPA_BIN'] ?? 'opa',
    [
      'run',
      '--server',
      `--addr=127.0.0.1:${opts.port}`,
      '--authentication=token',
      '--authorization=basic',
      '--ignore=.manifest',
      '--log-level=error',
      policy,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return child;
}

export async function waitOpa(port: number, token: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('OPA did not start');
}
