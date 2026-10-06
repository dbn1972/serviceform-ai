import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../db');
const pg = createRequire(join(DB_DIR, 'package.json'))('pg') as PgModule;

interface PgResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
export interface PgClient {
  query(text: string, values?: readonly unknown[]): Promise<PgResult>;
  release(): void;
}
export interface PgPool {
  query(text: string, values?: readonly unknown[]): Promise<PgResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (config: Record<string, unknown>) => PgPool;
  Client: new (config: Record<string, unknown>) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(text: string, values?: readonly unknown[]): Promise<PgResult>;
  };
}

const LOGINS = ['sf_t018_rt', 'sf_t018_other'] as const;

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function migrate(direction: 'up' | 'down' = 'up', count?: number): string {
  return execFileSync(
    'pnpm',
    [
      'exec',
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

export interface Harness {
  admin: PgPool;
  rt: PgPool;
  other: PgPool;
}

async function dropLogins(c: InstanceType<PgModule['Client']>): Promise<void> {
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
    [[...LOGINS]],
  );
  for (const role of LOGINS) {
    const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (exists.rows.length > 0) {
      const stmts = await c.query(
        `SELECT format('DROP OWNED BY %I', $1::text) AS a, format('DROP ROLE %I', $1::text) AS b`,
        [role],
      );
      await c.query(String(stmts.rows[0]?.['a']));
      await c.query(String(stmts.rows[0]?.['b']));
    }
  }
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  await withAdmin(dropLogins);
  migrate('up');
  await withAdmin(async (c) => {
    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
          CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;`);
    await c.query(
      `TRUNCATE sf_inspection.inspection_history, sf_inspection.checklist_item,
         sf_inspection.observation, sf_inspection.evidence_ref, sf_inspection.finding,
         sf_inspection.inspection, sf_inspection.idempotency_record,
         sf_inspection.outbox_event, sf_inspection.outbox_event_platform,
         sf_inspection.inbox_event, sf_inspection.inbox_event_platform RESTART IDENTITY CASCADE`,
    );
    const built = await c.query(
      `SELECT format('CREATE ROLE sf_t018_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp018_rw', $1::text) AS a,
              format('CREATE ROLE sf_t018_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw', $1::text) AS b`,
      [password],
    );
    await c.query(String(built.rows[0]?.['a']));
    await c.query(String(built.rows[0]?.['b']));
  });
  const parsed = new URL(adminUrl());
  const pool = (user: string, max: number): PgPool =>
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
    rt: pool('sf_t018_rt', 8),
    other: pool('sf_t018_other', 2),
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.other.end()]);
}

export async function asTenant<T>(
  pool: PgPool,
  tenant: string | null,
  fn: (c: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      if (tenant) await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
      await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', randomUUID()]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

export function pgCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}
