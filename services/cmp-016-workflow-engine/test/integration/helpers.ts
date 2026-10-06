import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { SqlPool } from '../../src/index.js';
import { ROOT } from '../fixtures/models.js';

/**
 * PostgreSQL harness. The driver is resolved through @serviceform/db (the migration package),
 * so this component declares no runtime dependency. Runtime access uses real LOGIN roles
 * (ADR-0006 condition 10; never SET ROLE from a superuser as a substitute).
 */
const DB_DIR = join(ROOT, 'db');
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
}
const pg = requireFromDb('pg') as { Pool: new (cfg: object) => PgPool };

export const RUNTIME_ROLE = 'sf_t016_rt';
export const PEER_ROLE = 'sf_t016_peer';
export const MIGRATIONS = ['1759540160000_cmp-016-workflow-engine', '1759540160001_cmp-016-outbox'];

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  return url;
}

export function migrate(direction: 'up' | 'down', count?: number): string {
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
    ALTER TABLE sf_workflow.workflow_version DISABLE TRIGGER workflow_version_immutable;
    ALTER TABLE sf_workflow.workflow_instance DISABLE TRIGGER workflow_instance_pin_guard;
    ALTER TABLE sf_workflow.migration_plan DISABLE TRIGGER migration_plan_guard;
    ALTER TABLE sf_workflow.workflow_request DISABLE TRIGGER workflow_request_status_guard;
    TRUNCATE sf_workflow.workflow_request, sf_workflow.workflow_instance, sf_workflow.migration_plan,
      sf_workflow.workflow_version, sf_workflow.workflow_definition, sf_workflow.idempotency_record,
      sf_workflow.outbox_event, sf_workflow.outbox_event_platform, sf_workflow.inbox_event,
      sf_workflow.inbox_event_platform RESTART IDENTITY CASCADE;
    ALTER TABLE sf_workflow.workflow_version ENABLE TRIGGER workflow_version_immutable;
    ALTER TABLE sf_workflow.workflow_instance ENABLE TRIGGER workflow_instance_pin_guard;
    ALTER TABLE sf_workflow.migration_plan ENABLE TRIGGER migration_plan_guard;
    ALTER TABLE sf_workflow.workflow_request ENABLE TRIGGER workflow_request_status_guard;
  `);
}

export async function setupHarness(): Promise<Harness> {
  const admin = new pg.Pool({ connectionString: adminUrl(), max: 4 });
  migrate('up');
  await dropLoginRoles(admin);
  await resetData(admin);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp008_rw') THEN
      CREATE ROLE sf_cmp008_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF; END $$;`);
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  for (const [role, group] of [
    [RUNTIME_ROLE, 'sf_cmp016_rw'],
    [PEER_ROLE, 'sf_cmp008_rw'],
  ] as const) {
    const ddl = await admin.query<{ s: string }>(
      `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, %I',
        $1::text, $2::text, $3::text) AS s`,
      [role, password, group],
    );
    await admin.query(ddl.rows[0]?.s ?? '');
  }
  const url = new URL(adminUrl());
  const login = (user: string) =>
    new pg.Pool({
      host: url.hostname,
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user,
      password,
      max: 4,
    });
  return { admin, rt: login(RUNTIME_ROLE), peer: login(PEER_ROLE) };
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

/** Runs fn as a runtime login inside one transaction with transaction-local tenant context. */
export async function asTenant<T>(
  pool: PgPool,
  tenant: string | null,
  fn: (
    q: <R = Record<string, unknown>>(sql: string, p?: unknown[]) => Promise<QueryResult<R>>,
  ) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (tenant) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
    const out = await fn((sql, p) => c.query(sql, p));
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export async function errorOf(
  p: Promise<unknown>,
): Promise<{ code?: string; hint?: string; message: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; hint?: string; message: string };
  }
  throw new Error('expected the statement to fail');
}
