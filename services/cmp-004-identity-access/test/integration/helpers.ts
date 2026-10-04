import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import { IdentityService } from '../../src/commands.js';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { SimulatedIdpAdapter } from '../../src/adapters/idp.js';
import { SimulatedDigiLockerIdentityAdapter } from '../../src/adapters/digilocker.js';
import { simulatedBinding } from '../../src/bindings.js';
import { registerIdentityAccess } from '../../src/plugin.js';
import {
  IdentityContextResolver,
  IdentityPrincipalVerifier,
  PgSessionDirectory,
} from '../../src/principal-verifier.js';
import { outboxAuditRecorder } from '../../src/audit.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = `CANARY-T2-${T2}`;
export const ACTOR_OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const PEPPER = 'int-pepper-not-a-production-secret';
export const OTP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const IDP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const DL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

const TEST_LOGIN_ROLES = ['sf_t004_rt', 'sf_t004_other'] as const;

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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp048_rw') THEN
        CREATE ROLE sf_cmp048_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
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

async function resetCmp004Data(c: pg.Client): Promise<void> {
  const present = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'sf_identity') AS exists`,
  );
  if (!present.rows[0]?.exists) return;
  await c.query(`
    TRUNCATE TABLE
      sf_identity.inbox_event,
      sf_identity.inbox_event_platform,
      sf_identity.outbox_event,
      sf_identity.outbox_event_platform,
      sf_identity.idempotency_record,
      sf_identity.idempotency_record_platform,
      sf_identity.account_recovery,
      sf_identity.identity_link,
      sf_identity.citizen_session,
      sf_identity.citizen_otp_challenge,
      sf_identity.session_lookup,
      sf_identity.officer_session,
      sf_identity.officer_principal,
      sf_identity.citizen_principal
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
    await resetCmp004Data(c);
    await createLoginRole(
      c,
      'CREATE ROLE sf_t004_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp004_rw',
      password,
    );
    await createLoginRole(
      c,
      'CREATE ROLE sf_t004_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp048_rw',
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
    rt: runtimePool('sf_t004_rt', 4),
    other: runtimePool('sf_t004_other', 2),
    password,
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

export async function buildApp(h: Harness) {
  const directory = new PgSessionDirectory(h.rt);
  const app = Fastify({ logger: false });
  const commands = new IdentityService({
    pool: h.rt,
    pepper: PEPPER,
    otp: new SimulatedOtpAdapter(
      simulatedBinding({ id: OTP_ID, connector_type: 'OTP', simulator_version: 'otp-sim-1' }),
      PEPPER,
    ),
    idp: new SimulatedIdpAdapter(
      simulatedBinding({
        id: IDP_ID,
        connector_type: 'DEPARTMENT_API',
        simulator_version: 'idp-sim-1',
      }),
      PEPPER,
    ),
    digilocker: new SimulatedDigiLockerIdentityAdapter(
      simulatedBinding({ id: DL_ID, connector_type: 'DIGILOCKER', simulator_version: 'dl-sim-1' }),
      PEPPER,
    ),
    authorizer: new ContractAuthorizer(),
    audit: outboxAuditRecorder,
    clock: () => new Date(),
    testRunId: 'int-run',
  });
  await registerIdentityAccess(app, {
    prefix: '/v1',
    commands,
    verifier: new IdentityPrincipalVerifier(directory),
    resolveContext: new IdentityContextResolver(directory, 'cell-01'),
    cellId: 'cell-01',
  });
  return { app, commands };
}
