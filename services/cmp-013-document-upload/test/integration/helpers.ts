import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../db');
const TEST_LOGIN_ROLES = ['sf_t013u_rt', 'sf_t013u_other'] as const;

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

async function withAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface Harness {
  admin: pg.Pool;
  rt: pg.Pool;
  other: pg.Pool;
}

async function execFormatted(c: pg.Client, template: string, arg: string): Promise<void> {
  const built = await c.query<{ s: string }>('SELECT format($1::text, $2::text) AS s', [
    template,
    arg,
  ]);
  await c.query(built.rows[0]?.s ?? '');
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  await withAdmin(async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
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
      TRUNCATE TABLE sf_upload.inbox_event, sf_upload.inbox_event_platform, sf_upload.outbox_event,
        sf_upload.outbox_event_platform, sf_upload.idempotency_record
      RESTART IDENTITY
    `);
    await c.query('ALTER TABLE sf_upload.document_scan_status DISABLE TRIGGER USER');
    await c.query('ALTER TABLE sf_upload.document_metadata DISABLE TRIGGER USER');
    await c.query('ALTER TABLE sf_upload.upload_policy DISABLE TRIGGER USER');
    await c.query(`
      DELETE FROM sf_upload.document_scan_status;
      DELETE FROM sf_upload.upload_session;
      DELETE FROM sf_upload.document_metadata;
      DELETE FROM sf_upload.upload_policy;
    `);
    await c.query('ALTER TABLE sf_upload.document_scan_status ENABLE TRIGGER USER');
    await c.query('ALTER TABLE sf_upload.document_metadata ENABLE TRIGGER USER');
    await c.query('ALTER TABLE sf_upload.upload_policy ENABLE TRIGGER USER');
    await execFormatted(
      c,
      'CREATE ROLE sf_t013u_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp013_rw',
      password,
    );
    await execFormatted(
      c,
      'CREATE ROLE sf_t013u_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw',
      password,
    );
  });
  const parsed = new URL(adminUrl());
  const pool = (user: string, max: number) =>
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
    rt: pool('sf_t013u_rt', 4),
    other: pool('sf_t013u_other', 2),
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.other.end()]);
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
