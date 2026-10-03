import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import { registerTenantOrganisation } from '../../src/plugin.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures } from '../doubles/context-resolver.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = `CANARY-T2-${T2}`;
export const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../db');

export function adminUrl(): string {
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
    '--check-order',
  ];
  return execFileSync('pnpm', ['exec', ...args], {
    cwd: DB_DIR,
    encoding: 'utf8',
    env: process.env,
  });
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

function rolePassword(): string {
  return createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
}

export interface Harness {
  admin: pg.Pool;
  rt: pg.Pool;
  rt2: pg.Pool;
  other: pg.Pool;
  password: string;
}

const TEST_LOGIN_ROLES = ['sf_t001_rt', 'sf_t001_rt2', 'sf_t001_other'] as const;

async function dropTestLoginRoles(c: pg.Client): Promise<void> {
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
    [TEST_LOGIN_ROLES as unknown as string[]],
  );
  for (const role of TEST_LOGIN_ROLES) {
    // DROP OWNED avoids leftover grants when re-running on a shared disposable DB.
    // Role identifiers via format(%I/%L) — no JS string interpolation into SQL.
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

async function ensurePeerGroupRoles(c: pg.Client): Promise<void> {
  await c.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
        CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
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
    END $$;
  `);
}

async function createLoginRole(c: pg.Client, ddl: string, password: string): Promise<void> {
  const created = await c.query<{ s: string }>('SELECT format($1::text, $2::text) AS s', [
    ddl,
    password,
  ]);
  await c.query(created.rows[0]?.s ?? '');
}

/**
 * Truncate CMP-002 data without touching sf_schema_migrations.
 * Safe on empty PG16 (no-op when schema absent) and on a full Wave 1 catalog.
 */
async function resetCmp002Data(c: pg.Client): Promise<void> {
  const present = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'sf_tenant_org') AS exists`,
  );
  if (!present.rows[0]?.exists) return;
  await c.query(`
    TRUNCATE TABLE
      sf_tenant_org.inbox_event,
      sf_tenant_org.inbox_event_platform,
      sf_tenant_org.outbox_event,
      sf_tenant_org.outbox_event_platform,
      sf_tenant_org.idempotency_record,
      sf_tenant_org.idempotency_record_platform,
      sf_tenant_org.office,
      sf_tenant_org.organisation_relation,
      sf_tenant_org.organisation_version,
      sf_tenant_org.organisation,
      sf_tenant_org.tenant_placement_proposal,
      sf_tenant_org.tenant_cell_binding,
      sf_tenant_org.tenant
    RESTART IDENTITY CASCADE
  `);
}

/**
 * F-V1-002: never DELETE a subset of sf_schema_migrations (breaks --check-order when later
 * Wave 1 names remain). Never DROP SCHEMA / DROP ROLE sf_cmp002_rw. migrate('up') is
 * idempotent on a full catalog and creates the catalog on empty disposable PG16.
 */
export async function setupHarness(): Promise<Harness> {
  const password = rolePassword();
  await withAdmin(async (c) => {
    await dropTestLoginRoles(c);
  });
  migrate('up');
  await withAdmin(async (c) => {
    await ensurePeerGroupRoles(c);
    await resetCmp002Data(c);
    await createLoginRole(
      c,
      'CREATE ROLE sf_t001_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp002_rw',
      password,
    );
    await createLoginRole(
      c,
      'CREATE ROLE sf_t001_rt2 LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp002_rw',
      password,
    );
    await createLoginRole(
      c,
      'CREATE ROLE sf_t001_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw',
      password,
    );
  });
  const parsed = new URL(adminUrl());
  const runtimePool = (role: string, max: number, application_name?: string) =>
    new pg.Pool({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user: role,
      password,
      max,
      ...(application_name ? { application_name } : {}),
    });
  return {
    admin: new pg.Pool({ connectionString: adminUrl(), max: 4 }),
    rt: runtimePool('sf_t001_rt', 4, 'cmp002-rt'),
    rt2: runtimePool('sf_t001_rt2', 1),
    other: runtimePool('sf_t001_other', 2),
    password,
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.rt2.end(), h.other.end()]);
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

export function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: partial.actor.type === 'PRIVILEGED_ADMIN' ? ['PLATFORM_OPERATOR'] : ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: partial.auth_assurance ?? 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

export async function buildApp(h: Harness, authorizer = new ContractAuthorizer()) {
  fixtures.clear();
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await registerTenantOrganisation(app, {
    prefix: '/v1',
    pool: h.rt,
    resolveContext: fixtureResolver,
    authorizer,
    clock: () => new Date('2026-10-03T12:00:00.000Z'),
  });
  return { app, authorizer };
}

export function bearer(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

export async function seedTenants(h: Harness): Promise<void> {
  await asTenant(h.rt, T1, ACTOR_OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
       VALUES ($1,'tenant-one','One','ACTIVE',$2)
       ON CONFLICT DO NOTHING`,
      [T1, ACTOR_OFFICER],
    );
    await c.query(
      `INSERT INTO sf_tenant_org.tenant_cell_binding (
         binding_id, tenant_id, cell_id, isolation_model, valid_from, seq, reason, requested_by
       ) VALUES ($1,$2,'cell-01','POOL','2026-01-01T00:00:00Z',1,'seed',$3)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), T1, ACTOR_OFFICER],
    );
  });
  await asTenant(h.rt, T2, ACTOR_OFFICER, async (c) => {
    await c.query(
      `INSERT INTO sf_tenant_org.tenant (tenant_id, code, display_name, status, created_by)
       VALUES ($1,'tenant-two',$2,'ACTIVE',$3)
       ON CONFLICT DO NOTHING`,
      [T2, CANARY, ACTOR_OFFICER],
    );
    await c.query(
      `INSERT INTO sf_tenant_org.tenant_cell_binding (
         binding_id, tenant_id, cell_id, isolation_model, valid_from, seq, reason, requested_by
       ) VALUES ($1,$2,'cell-02','SILO','2026-01-01T00:00:00Z',1,$3,$4)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), T2, CANARY, ACTOR_OFFICER],
    );
  });
}
