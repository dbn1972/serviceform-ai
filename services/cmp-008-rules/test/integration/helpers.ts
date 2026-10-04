import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import type { RequestContext } from '@serviceform/contracts';
import { loadConfig } from '../../src/config.js';
import { registerRules } from '../../src/plugin.js';
import { SimulatedRulePackPort } from '../../src/ports/rule-pack.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { fixtureResolver, fixtures, setFixture } from '../doubles/context-resolver.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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

/** CMP-008 pair only. Isolated reversibility must not assume these are the global tail. */
export const CMP008_MIGRATION_FILES = [
  '1759530200000_cmp-008-rules.sql',
  '1759530200001_cmp-008-outbox.sql',
] as const;

const CMP008_ISOLATED_CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...CMP008_MIGRATION_FILES,
] as const;

export interface CombinedCatalogSnapshot {
  migrationNames: string[];
  uploadTables: { relname: string; relfilenode: string }[];
  rulesPresent: boolean;
}

export async function snapshotCombinedCatalog(pool: pg.Pool): Promise<CombinedCatalogSnapshot> {
  const migrations = await pool.query<{ name: string }>(
    `SELECT name FROM sf_platform.sf_schema_migrations ORDER BY name`,
  );
  const upload = await pool.query<{ relname: string; relfilenode: string }>(
    `SELECT c.relname, c.relfilenode::text AS relfilenode
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'sf_upload' AND c.relkind = 'r'
      ORDER BY 1`,
  );
  const rules = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'sf_rules'`);
  return {
    migrationNames: migrations.rows.map((r) => r.name),
    uploadTables: upload.rows,
    rulesPresent: (rules.rowCount ?? 0) > 0,
  };
}

function isolatedMigrate(
  migrationsDir: string,
  databaseUrl: string,
  direction: 'up' | 'down',
  count?: number,
): string {
  const args = [
    'node-pg-migrate',
    direction,
    ...(count === undefined ? [] : [String(count)]),
    '--migrations-dir',
    migrationsDir,
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
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

/**
 * Throwaway database whose migration directory contains only platform deps + the CMP-008 pair.
 * Combined-catalog `node-pg-migrate down N` is not used: later Wave A files (CMP-013) stay applied.
 */
export async function withIsolatedCmp008Database<T>(
  admin: pg.Pool,
  fn: (
    iso: pg.Client,
    migrateIso: (direction: 'up' | 'down', count?: number) => string,
  ) => Promise<T>,
): Promise<T> {
  const name = `sf_cmp008_rev_${randomBytes(4).toString('hex')}`;
  if (!/^sf_cmp008_rev_[0-9a-f]{8}$/.test(name)) {
    throw new Error('isolated database name failed allowlist');
  }
  const tmp = mkdtempSync(join(tmpdir(), 'cmp008-rev-'));
  const parsed = new URL(adminUrl());
  parsed.pathname = `/${name}`;
  const isoUrl = parsed.toString();
  const createSql = `CREATE DATABASE ${name} TEMPLATE template0`;
  const dropSql = `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`;
  try {
    for (const file of CMP008_ISOLATED_CHAIN) {
      copyFileSync(join(DB_DIR, 'migrations', file), join(tmp, file));
    }
    await admin.query(createSql);
    const iso = new pg.Client({ connectionString: isoUrl });
    await iso.connect();
    try {
      return await fn(iso, (direction, count) => isolatedMigrate(tmp, isoUrl, direction, count));
    } finally {
      await iso.end();
    }
  } finally {
    await admin.query(dropSql);
    rmSync(tmp, { recursive: true, force: true });
  }
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

export interface Harness {
  admin: pg.Pool;
  rt: pg.Pool;
  other: pg.Pool;
  password: string;
}

const TEST_LOGIN_ROLES = ['sf_t008_rt', 'sf_t008_other'] as const;

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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp051_rw') THEN
        CREATE ROLE sf_cmp051_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
  `);
}

async function resetCmp008Data(c: pg.Client): Promise<void> {
  const present = await c.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'sf_rules') AS exists`,
  );
  if (!present.rows[0]?.exists) return;
  await c.query(`
    ALTER TABLE sf_rules.evaluation_record DISABLE TRIGGER evaluation_record_immutable;
    ALTER TABLE sf_rules.rule_pack_snapshot DISABLE TRIGGER rule_pack_snapshot_immutable;
    TRUNCATE TABLE
      sf_rules.inbox_event,
      sf_rules.inbox_event_platform,
      sf_rules.outbox_event,
      sf_rules.outbox_event_platform,
      sf_rules.idempotency_record,
      sf_rules.evaluation_record,
      sf_rules.rule_pack_snapshot
    RESTART IDENTITY CASCADE;
    ALTER TABLE sf_rules.evaluation_record ENABLE TRIGGER evaluation_record_immutable;
    ALTER TABLE sf_rules.rule_pack_snapshot ENABLE TRIGGER rule_pack_snapshot_immutable;
  `);
}

async function createLoginRole(c: pg.Client, ddl: string, password: string): Promise<void> {
  const created = await c.query<{ s: string }>('SELECT format($1::text, $2::text) AS s', [
    ddl,
    password,
  ]);
  await c.query(created.rows[0]?.s ?? '');
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  await withAdmin(dropTestLoginRoles);
  migrate('up');
  await withAdmin(async (c) => {
    await ensurePeerGroupRoles(c);
    await resetCmp008Data(c);
    await createLoginRole(
      c,
      'CREATE ROLE sf_t008_rt LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp008_rw',
      password,
    );
    await createLoginRole(
      c,
      'CREATE ROLE sf_t008_other LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp051_rw',
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
    rt: runtimePool('sf_t008_rt', 4),
    other: runtimePool('sf_t008_other', 2),
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

export function ctx(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenant_id' | 'actor'>,
): RequestContext {
  return {
    cell_id: 'cell-01',
    roles: ['CASE_OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: TRACE,
    ...partial,
  };
}

export async function buildApp(h: Harness) {
  fixtures.clear();
  const config = loadConfig({ SF_ENVIRONMENT: 'LOCAL', SF_CMP008_PACK_SOURCE_MODE: 'SIMULATED' });
  const packs = new SimulatedRulePackPort(config);
  const authorizer = new ContractAuthorizer();
  const app = Fastify({ logger: false });
  await registerRules(app, {
    pool: h.rt,
    resolveContext: fixtureResolver,
    authorizer,
    rulePacks: packs,
    config,
    clock: () => new Date('2026-10-04T12:00:00.000Z'),
  });
  return { app, packs, authorizer };
}

export function installTenant(token: string, tenantId: string): RequestContext {
  const c = ctx({ tenant_id: tenantId, actor: { type: 'OFFICER', id: ACTOR } });
  setFixture(token, c);
  return c;
}
