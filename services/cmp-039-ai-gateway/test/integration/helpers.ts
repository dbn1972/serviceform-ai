import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerAiGateway } from '../../src/plugin.js';
import {
  SimulatedPurposeConsentPort,
  SimulatedSourceAclPort,
} from '../../src/ports/policy-ports.js';
import { buildProviderRegistry, type SimulatedScenario } from '../../src/ports/provider.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures, setFixture } from '../doubles/context-resolver.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const OFFICER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OTHER_OFFICER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
  other: pg.Pool;
  password: string;
}

const TEST_LOGIN_ROLES = ['sf_t039_rt', 'sf_t039_other'] as const;

async function dropTestLoginRoles(c: pg.Client): Promise<void> {
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
    [TEST_LOGIN_ROLES as unknown as string[]],
  );
  for (const role of TEST_LOGIN_ROLES) {
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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp033_rw') THEN
        CREATE ROLE sf_cmp033_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
  `);
}

async function resetCmp039Data(c: pg.Client): Promise<void> {
  const present = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'sf_ai_gateway') AS exists`,
  );
  if (!present.rows[0]?.exists) return;
  await c.query(`
    TRUNCATE TABLE
      sf_ai_gateway.inbox_event,
      sf_ai_gateway.inbox_event_platform,
      sf_ai_gateway.outbox_event,
      sf_ai_gateway.outbox_event_platform,
      sf_ai_gateway.idempotency_record,
      sf_ai_gateway.ai_request_metadata,
      sf_ai_gateway.ai_policy,
      sf_ai_gateway.model_registry
    RESTART IDENTITY CASCADE
  `);
}

export async function setupHarness(): Promise<Harness> {
  const password = rolePassword();
  await withAdmin(async (c) => {
    await dropTestLoginRoles(c);
  });
  migrate('up');
  await withAdmin(async (c) => {
    await ensurePeerGroupRoles(c);
    await resetCmp039Data(c);
    await createLoginRole(
      c,
      'CREATE ROLE sf_t039_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp039_rw',
      password,
    );
    await createLoginRole(
      c,
      'CREATE ROLE sf_t039_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp033_rw',
      password,
    );
  });
  const parsed = new URL(adminUrl());
  const runtimePool = (role: string, max: number) =>
    new pg.Pool({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user: role,
      password,
      max,
    });
  return {
    admin: new pg.Pool({ connectionString: adminUrl(), max: 4 }),
    rt: runtimePool('sf_t039_rt', 4),
    other: runtimePool('sf_t039_other', 2),
    password,
  };
}

async function createLoginRole(c: pg.Client, ddl: string, password: string): Promise<void> {
  const created = await c.query<{ s: string }>('SELECT format($1::text, $2::text) AS s', [
    ddl,
    password,
  ]);
  await c.query(created.rows[0]?.s ?? '');
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

export function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: ['SERVICE_DESIGNER'],
    jurisdiction_ids: [],
    auth_assurance: partial.auth_assurance ?? 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

export async function buildApp(
  h: Harness,
  authorizer = new ContractAuthorizer(),
  extras: { scenarios?: Record<string, SimulatedScenario> } = {},
) {
  fixtures.clear();
  const config = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP039_PROVIDER_MODE: 'SIMULATED' });
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const consent = new SimulatedPurposeConsentPort();
  const sources = new SimulatedSourceAclPort();
  await registerAiGateway(app, {
    prefix: '/v1',
    pool: h.rt,
    resolveContext: fixtureResolver,
    authorizer,
    providers: buildProviderRegistry(config, extras.scenarios ?? {}),
    consent,
    sources,
    config,
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
  });
  return { app, authorizer, consent, sources };
}

export function bearer(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

export function installActor(token: string, tenantId: string, actorId: string): RequestContext {
  const c = ctx({
    tenant_id: tenantId,
    actor: { type: 'OFFICER', id: actorId },
  });
  setFixture(token, c);
  return c;
}
