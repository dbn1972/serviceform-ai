import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequestContext } from '../../../packages/contracts/src/index.js';
import { withContextTx as cmp059Tx } from '../../../services/cmp-059-migration-workbench/src/db/tx.js';
import {
  envelopeOf,
  insertOutbox,
} from '../../../services/cmp-059-migration-workbench/src/db/outbox.js';
import { withContextTx as cmp060Tx } from '../../../services/cmp-060-risk-integrity/src/db/tx.js';

/**
 * Live PostgreSQL probes for M09 schemas. Requires DATABASE_URL (admin able to CREATE DATABASE/ROLE).
 * Runs the real M09 migrations in a throwaway database and drives the components' own
 * transaction helpers through login roles that inherit only the documented runtime roles.
 */
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const DB_DIR = join(ROOT, 'db');
const ADMIN_URL = process.env['DATABASE_URL'];
const requireFromDb = createRequire(join(DB_DIR, 'package.json'));

const M09_SCHEMAS = [
  'sf_scheduler',
  'sf_assisted',
  'sf_semantics',
  'sf_migration',
  'sf_risk',
  'sf_privacy',
];
const CHAIN = [
  '1759482000000_platform-baseline.sql',
  '1759490000000_shared-db-contracts.sql',
  ...readdirSync(join(DB_DIR, 'migrations')).filter((f) => /_cmp-0(5[6-9]|6[01])-.*\.sql$/.test(f)),
].sort();

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '99999999-9999-4999-8999-999999999999';
const CANARY = 'sec-canary-7f3e9a';

function ctxFor(tenant: string): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-local',
    actor: { type: 'OFFICER', id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42' },
    roles: ['SERVICE_CHECKER'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

interface PoolClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  release(): void;
}
interface Pool {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

type PgModule = {
  Pool: new (cfg: object) => Pool;
};

interface Harness {
  pg: PgModule;
  admin: Pool;
  dbAdmin: Pool;
  dbName: string;
  roles: { peer: string; rt059: string; rt060: string };
  peer: Pool;
  rt059: Pool;
  rt060: Pool;
}

let h: Harness | undefined;
function H(): Harness {
  if (!h) throw new Error('live harness not initialised');
  return h;
}

async function ddl(pool: Pool, template: string, ...args: string[]): Promise<void> {
  const res = await pool.query<{ s: string }>('SELECT format($1::text, VARIADIC $2::text[]) AS s', [
    template,
    args,
  ]);
  await pool.query(String(res.rows[0]?.s ?? ''));
}

async function setup(): Promise<Harness> {
  const pg = requireFromDb('pg') as PgModule;
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  admin.on('error', () => undefined);
  const suffix = randomBytes(3).toString('hex');
  const dbName = `sf_m09_sec_${suffix}`;
  await ddl(admin, 'CREATE DATABASE %I TEMPLATE template0', dbName);
  const url = new URL(String(ADMIN_URL));
  url.pathname = `/${dbName}`;

  const tmp = mkdtempSync(join(tmpdir(), 'm09-sec-'));
  try {
    for (const f of CHAIN) copyFileSync(join(DB_DIR, 'migrations', f), join(tmp, f));
    execFileSync(
      'pnpm',
      [
        'exec',
        'node-pg-migrate',
        'up',
        '--migrations-dir',
        tmp,
        '--migrations-table',
        'sf_schema_migrations',
        '--migrations-schema',
        'sf_platform',
        '--create-migrations-schema',
        '--check-order',
      ],
      { cwd: DB_DIR, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url.toString() } },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const dbAdmin = new pg.Pool({ connectionString: url.toString(), max: 2 });
  dbAdmin.on('error', () => undefined);
  const password = randomBytes(12).toString('hex');
  const roles = {
    peer: `sf_m09sec_peer_${suffix}`,
    rt059: `sf_m09sec_rt059_${suffix}`,
    rt060: `sf_m09sec_rt060_${suffix}`,
  };
  const memberships: Record<string, readonly string[]> = {
    [roles.peer]: ['sf_app'],
    [roles.rt059]: ['sf_app', 'sf_cmp059_rw'],
    [roles.rt060]: ['sf_app', 'sf_cmp060_rw'],
  };
  for (const [role, inRoles] of Object.entries(memberships)) {
    await ddl(
      dbAdmin,
      'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT',
      role,
      password,
    );
    for (const group of inRoles) await ddl(dbAdmin, 'GRANT %I TO %I', group, role);
    await ddl(dbAdmin, 'GRANT CONNECT ON DATABASE %I TO %I', dbName, role);
  }
  const poolFor = (user: string) => {
    const p = new pg.Pool({
      host: url.hostname || '127.0.0.1',
      port: Number(url.port || 5432),
      database: dbName,
      user,
      password,
      max: 1,
    });
    p.on('error', () => undefined);
    return p;
  };
  return {
    pg,
    admin,
    dbAdmin,
    dbName,
    roles,
    peer: poolFor(roles.peer),
    rt059: poolFor(roles.rt059),
    rt060: poolFor(roles.rt060),
  };
}

async function teardown(x: Harness): Promise<void> {
  await Promise.all([x.peer.end(), x.rt059.end(), x.rt060.end()]);
  await x.dbAdmin.end();
  await ddl(x.admin, 'DROP DATABASE IF EXISTS %I WITH (FORCE)', x.dbName);
  for (const role of Object.values(x.roles)) await ddl(x.admin, 'DROP ROLE IF EXISTS %I', role);
  await x.admin.end();
}

/** Reads as another component's runtime principal (sf_app only) with `tenant` in every known GUC. */
async function readAsTenant<R>(tenant: string, sql: string, params: unknown[] = []): Promise<R[]> {
  const c = await H().peer.connect();
  try {
    await c.query('BEGIN');
    for (const key of ['app.tenant_id', 'sf.tenant_id', 'app.current_tenant_id']) {
      await c.query('SELECT set_config($1, $2, true)', [key, tenant]);
    }
    const res = await c.query(sql, params);
    await c.query('ROLLBACK');
    return res.rows as R[];
  } finally {
    c.release();
  }
}

describe.skipIf(!ADMIN_URL)('SF-M09-SEC live RLS probes (PostgreSQL)', () => {
  beforeAll(async () => {
    h = await setup();
  }, 180_000);
  afterAll(async () => {
    if (h) await teardown(h);
  });

  it('applies baseline + all M09 migrations in an isolated database', async () => {
    const res = await H().dbAdmin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_namespace WHERE nspname = ANY($1)`,
      [M09_SCHEMAS],
    );
    expect(res.rows[0]?.n).toBe(String(M09_SCHEMAS.length));
  });

  it('every M09 table carrying tenant_id that sf_app can SELECT has ENABLE + FORCE RLS', async () => {
    const res = await H().dbAdmin.query<{ t: string; rls: boolean; force: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE c.relkind = 'r' AND n.nspname = ANY($1)
          AND has_table_privilege('sf_app', c.oid, 'SELECT')
        ORDER BY 1`,
      [M09_SCHEMAS],
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(10);
    const unprotected = res.rows.filter((r) => !(r.rls && r.force)).map((r) => r.t);
    expect(unprotected, 'tenant-carrying tables readable by sf_app without FORCE RLS').toEqual([]);
  });

  it('CMP-059 outbox: a T1 event written by CMP-059 is not readable by another tenant/component session', async () => {
    await cmp059Tx(H().rt059 as never, ctxFor(T1), async (client) => {
      await insertOutbox(
        client as never,
        envelopeOf(T1, 'MigrationCompleted', { project_id: CANARY, batch_id: CANARY }),
      );
    });
    const leaked = await readAsTenant<{ tenant_id: string; payload: unknown }>(
      T2,
      'SELECT tenant_id, payload FROM sf_migration.outbox_event WHERE tenant_id = $1',
      [T1],
    );
    expect(
      leaked.filter((r) => JSON.stringify(r.payload).includes(CANARY)).length,
      'CROSS_TENANT_LEAKAGE rows (T2 session reading T1 sf_migration.outbox_event)',
    ).toBe(0);
  });

  it('control: a T1 row in a FORCE-RLS sf_migration table is visible to T1 and invisible to T2', async () => {
    await H().dbAdmin.query(
      `INSERT INTO sf_migration.idempotency_record
         (tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at)
       VALUES ($1, $2, 'control', $3, $4, 'COMPLETED', now(), now())`,
      [T1, ctxFor(T1).actor.id, `${CANARY}-idem`, 'f'.repeat(64)],
    );
    const sql = 'SELECT tenant_id FROM sf_migration.idempotency_record';
    expect(await readAsTenant(T1, sql)).toHaveLength(1);
    expect(await readAsTenant(T2, sql)).toEqual([]);
  });

  it('CMP-059 transaction context satisfies sf_platform.current_tenant_id() (SF-CON-DB-SESSION-CONTEXT)', async () => {
    const seen = await cmp059Tx(H().rt059 as never, ctxFor(T1), async (client) => {
      const r = await (client as unknown as Pool).query<{ t: string | null }>(
        'SELECT sf_platform.current_tenant_id()::text AS t',
      );
      return r.rows[0]?.t ?? null;
    });
    expect(seen).toBe(T1);
  });

  it('CMP-060 transaction context satisfies sf_platform.current_tenant_id() (SF-CON-DB-SESSION-CONTEXT)', async () => {
    const seen = await cmp060Tx(H().rt060 as never, T1, 'cell-local', async (client) => {
      const r = await (client as unknown as Pool).query<{ t: string | null }>(
        'SELECT sf_platform.current_tenant_id()::text AS t',
      );
      return r.rows[0]?.t ?? null;
    });
    expect(seen).toBe(T1);
  });

  it('CMP-059 RLS fails closed (no error, no rows) on a reused pooled session with no tenant set', async () => {
    await cmp059Tx(H().rt059 as never, ctxFor(T1), async () => undefined);
    const c = await H().rt059.connect();
    try {
      const res = await c.query('SELECT count(*)::int AS n FROM sf_migration.migration_project');
      expect(res.rows[0]?.n).toBe(0);
    } finally {
      c.release();
    }
  });
});
