import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Component schemas that Wave 1 migrations create. Must not survive an empty-catalog reset. */
export const COMPONENT_SCHEMAS = [
  'sf_tenant_org',
  'sf_security',
  'sf_audit',
  'sf_event_bus',
  'sf_integration_hub',
] as const;

export const SERVICEFORM_ROLES = [
  'sf_app',
  'sf_migrator',
  'sf_outbox_publisher',
  'sf_cmp002_rw',
  'sf_cmp031_rw',
  'sf_cmp037_rw',
  'sf_cmp038_rw',
  'sf_cmp048_rw',
] as const;

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required for database integration tests');
  return url;
}

export async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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
    '--check-order',
  ];
  return execFileSync('pnpm', ['exec', ...args], {
    cwd: DB_DIR,
    encoding: 'utf8',
    env: process.env,
  });
}

/**
 * Drop every ServiceForm schema in the connected database. Test teardown only.
 * Does not rewrite production CREATE SCHEMA to IF NOT EXISTS. Does not DROP ROLE:
 * privilege roles are cluster-wide and Wave 1 downs already drop their own _rw roles.
 */
export async function dropServiceformCatalog(): Promise<void> {
  await withClient(async (c) => {
    await c.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT nspname FROM pg_namespace
          WHERE nspname LIKE 'sf_%'
        LOOP
          EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname);
        END LOOP;
      END
      $$;
    `);
  });
}

export async function listSfSchemas(): Promise<string[]> {
  return withClient(async (c) => {
    const { rows } = await c.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sf_%' ORDER BY 1`,
    );
    return rows.map((r) => r.nspname);
  });
}
