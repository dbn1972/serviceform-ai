import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlPool, SqlQueryResult } from '../../src/store/pg-store.js';

export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../db');

export interface PgClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  release(err?: Error | boolean): void;
}
export interface PgPool extends SqlPool {
  connect(): Promise<PgClient>;
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}
interface PgStandaloneClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (config: object) => PgPool;
  Client: new (config: object) => PgStandaloneClient;
}

const loadFromDb = createRequire(join(DB_DIR, 'package.json'));
const pg = loadFromDb('pg') as PgModule;

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const RT_ROLE = 'sf_t035_rt';
export const PEER_ROLE = 'sf_t035_peer';
export const APP_ONLY_ROLE = 'sf_t035_apponly';
const TEST_LOGIN_ROLES = [RT_ROLE, PEER_ROLE, APP_ONLY_ROLE] as const;

export function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required for CMP-035 integration tests');
  return url;
}

export function migrate(
  direction: 'up' | 'down',
  count?: number,
  url = adminUrl(),
  dir = 'migrations',
): string {
  const args = [
    'node-pg-migrate',
    direction,
    ...(count === undefined ? [] : [String(count)]),
    '--migrations-dir',
    dir,
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
    env: { ...process.env, DATABASE_URL: url },
  });
}

export async function withAdmin<T>(
  fn: (c: PgStandaloneClient) => Promise<T>,
  url = adminUrl(),
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function dropTestLoginRoles(c: PgStandaloneClient): Promise<void> {
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ANY($1::text[]) AND pid <> pg_backend_pid()`,
    [TEST_LOGIN_ROLES as unknown as string[]],
  );
  for (const role of TEST_LOGIN_ROLES) {
    const built = await c.query(
      `SELECT format('DO $do$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN DROP OWNED BY %I; DROP ROLE %I; END IF; END $do$', $1::text, $1::text, $1::text) AS s`,
      [role],
    );
    await c.query(String(built.rows[0]?.['s'] ?? ''));
  }
}

async function createLoginRole(
  c: PgStandaloneClient,
  ddl: string,
  password: string,
): Promise<void> {
  const built = await c.query('SELECT format($1::text, $2::text) AS s', [ddl, password]);
  await c.query(String(built.rows[0]?.['s'] ?? ''));
}

export async function resetCmp035Data(c: PgStandaloneClient): Promise<void> {
  await c.query(`
    TRUNCATE TABLE
      sf_search.inbox_event,
      sf_search.inbox_event_platform,
      sf_search.outbox_event,
      sf_search.outbox_event_platform,
      sf_search.search_document
    RESTART IDENTITY CASCADE`);
}

export interface Harness {
  admin: PgPool;
  rt: PgPool;
  peer: PgPool;
  appOnly: PgPool;
}

export async function setupHarness(): Promise<Harness> {
  const password = createHash('sha256').update(randomBytes(16)).digest('hex').slice(0, 24);
  await withAdmin(dropTestLoginRoles);
  migrate('up');
  await withAdmin(async (c) => {
    await resetCmp035Data(c);
    await createLoginRole(
      c,
      `CREATE ROLE ${RT_ROLE} LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp035_rw`,
      password,
    );
    await createLoginRole(
      c,
      `CREATE ROLE ${PEER_ROLE} LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app, sf_cmp015_rw`,
      password,
    );
    await createLoginRole(
      c,
      `CREATE ROLE ${APP_ONLY_ROLE} LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE sf_app`,
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
    admin: new pg.Pool({ connectionString: adminUrl(), max: 4 }),
    rt: pool(RT_ROLE, 6),
    peer: pool(PEER_ROLE, 2),
    appOnly: pool(APP_ONLY_ROLE, 2),
  };
}

export async function closeHarness(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await Promise.all([h.admin.end(), h.rt.end(), h.peer.end(), h.appOnly.end()]);
  await withAdmin(dropTestLoginRoles);
}

export async function asTenant<T>(
  pool: PgPool,
  tenant: string | null,
  fn: (c: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenant) await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant]);
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', ACTOR]);
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

export function documentInsert(
  tenant: string,
  documentId: string = randomUUID(),
  facets: Record<string, unknown> = { state: 'SUBMITTED' },
): [string, unknown[]] {
  return [
    `INSERT INTO sf_search.search_document (
       document_id, tenant_id, cell_id, source_cmp_id, source_record_id, source_aggregate_type,
       source_topic, source_version, source_event_id, source_event_type, source_occurred_at,
       projection_rule_id, projection_rule_version, facets, status, revision, indexed_at,
       updated_at, last_correlation_id
     ) VALUES ($1,$2,'cell-01','CMP-015',$3,'ApplicationCase','sf.case.events.v1',1,$4,
       'CaseSubmitted',now(),$5,1,$6::jsonb,'ACTIVE',1,now(),now(),$7)`,
    [
      documentId,
      tenant,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      JSON.stringify(facets),
      randomUUID(),
    ],
  ];
}

export const CMP035_TABLES = ['search_document'] as const;
export type Cmp035Table = (typeof CMP035_TABLES)[number];

export const TABLE_SQL: Record<Cmp035Table, { select1: string; deleteAll: string }> =
  Object.fromEntries(
    CMP035_TABLES.map((t) => [
      t,
      {
        select1: 'SELECT 1 FROM sf_search.' + t + ' LIMIT 1',
        deleteAll: 'DELETE FROM sf_search.' + t,
      },
    ]),
  ) as Record<Cmp035Table, { select1: string; deleteAll: string }>;
