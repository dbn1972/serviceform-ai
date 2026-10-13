import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asTenant,
  closeHarness,
  MIGRATION_FILES,
  OFFICER,
  resetData,
  RUNTIME_ROLE,
  setupHarness,
  T1,
  T2,
  withIsolatedDatabase,
  type Harness,
  type PgClient,
} from './helpers.js';

const CITIZEN = '55555555-5555-4555-8555-555555555555';
const CATALOGUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BINDING = 'd1111111-1111-4111-8111-111111111111';

async function denied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? 'error';
  }
}

async function insertQuery(
  c: PgClient,
  tenant: string,
  over: Partial<{
    actorType: string;
    actorId: string;
    nonStatutory: boolean;
    draft: boolean;
    jurisdictions: string[];
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO sf_discovery.discovery_query (
       tenant_id, query_id, actor_type, actor_id, catalogue_version_id, jurisdiction_codes,
       keyword_count, pagination_limit, pagination_offset, result_count, excluded_count, has_more,
       result_is_non_statutory, draft_created, created_at, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6::text[],0,20,0,1,0,false,$7,$8,now(),$9)`,
    [
      tenant,
      id,
      over.actorType ?? 'CITIZEN',
      over.actorId ?? CITIZEN,
      CATALOGUE,
      over.jurisdictions ?? ['JUR-P-01'],
      over.nonStatutory ?? true,
      over.draft ?? false,
      randomUUID(),
    ],
  );
  return id;
}

async function insertResult(
  c: PgClient,
  tenant: string,
  queryId: string,
  serviceId: string,
  over: Partial<{ catalogue: string; rank: number }> = {},
): Promise<void> {
  await c.query(
    `INSERT INTO sf_discovery.discovery_result (
       tenant_id, query_id, rank, service_id, service_code, category_code,
       service_binding_version_id, catalogue_version_id, matched_jurisdiction_codes
     ) VALUES ($1,$2,$3,$4,'SVC_SYNTHETIC_01',NULL,$5,$6,ARRAY['JUR-P'])`,
    [tenant, queryId, over.rank ?? 1, serviceId, BINDING, over.catalogue ?? CATALOGUE],
  );
}

function insertSelection(
  c: PgClient,
  tenant: string,
  queryId: string,
  serviceId: string,
  over: Partial<{ actorId: string; actorType: string; binding: string }> = {},
): Promise<unknown> {
  return c.query(
    `INSERT INTO sf_discovery.discovery_selection (
       tenant_id, selection_id, query_id, service_id, service_code, service_binding_version_id,
       catalogue_version_id, actor_type, actor_id, selected_at, correlation_id
     ) VALUES ($1,$2,$3,$4,'SVC_SYNTHETIC_01',$5,$6,$7,$8,now(),$9)`,
    [
      tenant,
      randomUUID(),
      queryId,
      serviceId,
      over.binding ?? BINDING,
      CATALOGUE,
      over.actorType ?? 'CITIZEN',
      over.actorId ?? CITIZEN,
      randomUUID(),
    ],
  );
}

describe('CMP-006 privilege boundary (ADR-0006), FORCE RLS and DB guards (INT-011, INT-003)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 180_000);

  beforeEach(async () => {
    await resetData(h.admin);
  });

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles: NOLOGIN privilege role, no SUPERUSER/BYPASSRLS, tables owned by sf_migrator with FORCE RLS', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [['sf_cmp006_rw', 'sf_migrator', RUNTIME_ROLE]],
    );
    expect(roles.rows).toHaveLength(3);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] !== RUNTIME_ROLE) expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_discovery' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'discovery_query',
      'discovery_result',
      'discovery_selection',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'outbox_event',
      'outbox_event_platform',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) {
        expect(t['rls'], String(t['relname'])).toBe(true);
        expect(t['forced'], String(t['relname'])).toBe(true);
      }
    }
  });

  it('sf_app holds no DML on discovery state; a peer privilege role cannot read or write it', async () => {
    const appDml = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_discovery' AND grantee = 'sf_app' AND table_name LIKE 'discovery_%'`,
    );
    expect(appDml.rows).toEqual([]);
    expect(await denied(() => asTenant(h.peer, T1, OFFICER, (c) => insertQuery(c, T1)))).not.toBe(
      'allowed',
    );
    expect(
      await denied(() =>
        asTenant(h.peer, T1, OFFICER, (c) => c.query('SELECT 1 FROM sf_discovery.discovery_query')),
      ),
    ).not.toBe('allowed');
    const crossGrants = await h.admin.query(
      `SELECT table_schema, table_name FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp006_rw' AND table_schema <> 'sf_discovery'`,
    );
    expect(crossGrants.rows).toEqual([]);
    const writeGrants = await h.admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'sf_cmp006_rw' AND table_schema = 'sf_discovery'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE') AND table_name LIKE 'discovery_%'`,
    );
    expect(writeGrants.rows).toEqual([]);
  });

  it('FORCE RLS hides the other tenant; a session with no tenant sees nothing and cannot write', async () => {
    await asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T1));
    await asTenant(h.rt, T2, OFFICER, (c) => insertQuery(c, T2));
    const t1 = await asTenant(h.rt, T1, OFFICER, async (c) =>
      (await c.query('SELECT tenant_id FROM sf_discovery.discovery_query')).rows.map(
        (r) => r['tenant_id'],
      ),
    );
    expect(t1).toEqual([T1]);
    const none = await asTenant(
      h.rt,
      null,
      OFFICER,
      async (c) => (await c.query('SELECT 1 FROM sf_discovery.discovery_query')).rows,
    );
    expect(none).toEqual([]);
    expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T2)))).toBe(
      '42501',
    );
    expect(await denied(() => asTenant(h.rt, null, OFFICER, (c) => insertQuery(c, T1)))).not.toBe(
      'allowed',
    );
  });

  it('a tenant cannot attach results or selections to another tenant query (FK + RLS)', async () => {
    const q2 = await asTenant(h.rt, T2, OFFICER, (c) => insertQuery(c, T2));
    const svc = randomUUID();
    await asTenant(h.rt, T2, OFFICER, (c) => insertResult(c, T2, q2, svc));
    expect(
      await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertResult(c, T1, q2, randomUUID()))),
    ).not.toBe('allowed');
    expect(
      await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertSelection(c, T1, q2, svc))),
    ).not.toBe('allowed');
  });

  it('non-statutory and no-draft markers cannot be flipped; codes are validated', async () => {
    for (const over of [
      { nonStatutory: false },
      { draft: true },
      { jurisdictions: [] },
      { jurisdictions: ['bad code'] },
    ]) {
      expect(
        await denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T1, over))),
        JSON.stringify(over),
      ).toBe('23514');
    }
  });

  it('results must carry the query catalogue pin', async () => {
    const q = await asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T1));
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          insertResult(c, T1, q, randomUUID(), { catalogue: randomUUID() }),
        ),
      ),
    ).toBe('23503');
  });

  it('INT-003: only the owning citizen may select, only a recorded result, with its exact pins, once', async () => {
    const q = await asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T1));
    const svc = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) => insertResult(c, T1, q, svc));
    const sel = (
      over: Parameters<typeof insertSelection>[4] = {},
      serviceId = svc,
    ): Promise<string> =>
      denied(() => asTenant(h.rt, T1, OFFICER, (c) => insertSelection(c, T1, q, serviceId, over)));
    expect(await sel({ actorId: randomUUID() })).toBe('23503');
    expect(await sel({ actorType: 'OFFICER' })).toBe('23514');
    expect(await sel({}, randomUUID())).toBe('23503');
    expect(await sel({ binding: randomUUID() })).toBe('23503');
    expect(await sel()).toBe('allowed');
    expect(await sel()).toBe('23505');
    const staffQuery = await asTenant(h.rt, T1, OFFICER, (c) =>
      insertQuery(c, T1, { actorType: 'OFFICER', actorId: OFFICER }),
    );
    const svc2 = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) => insertResult(c, T1, staffQuery, svc2));
    expect(
      await denied(() =>
        asTenant(h.rt, T1, OFFICER, (c) =>
          insertSelection(c, T1, staffQuery, svc2, { actorId: OFFICER }),
        ),
      ),
    ).toBe('23503');
  });

  it('query log, results and selections are insert-only', async () => {
    const q = await asTenant(h.rt, T1, OFFICER, (c) => insertQuery(c, T1));
    const svc = randomUUID();
    await asTenant(h.rt, T1, OFFICER, (c) => insertResult(c, T1, q, svc));
    await asTenant(h.rt, T1, OFFICER, (c) => insertSelection(c, T1, q, svc));
    for (const sql of [
      'UPDATE sf_discovery.discovery_query SET result_count = 0 WHERE tenant_id = $1',
      'DELETE FROM sf_discovery.discovery_query WHERE tenant_id = $1',
      'UPDATE sf_discovery.discovery_result SET rank = 2 WHERE tenant_id = $1',
      'DELETE FROM sf_discovery.discovery_result WHERE tenant_id = $1',
      'UPDATE sf_discovery.discovery_selection SET draft_created = false WHERE tenant_id = $1',
      'DELETE FROM sf_discovery.discovery_selection WHERE tenant_id = $1',
    ]) {
      expect(await denied(() => asTenant(h.rt, T1, OFFICER, (c) => c.query(sql, [T1]))), sql).toBe(
        '42501',
      );
    }
  });

  it('migration pair is reversible in an isolated database (down 2 then up 2)', async () => {
    await withIsolatedDatabase(h.admin, async (iso, migrateIso) => {
      migrateIso('up');
      const has = async (): Promise<boolean> =>
        (
          await iso.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'sf_discovery'`,
          )
        ).rows[0]?.n === 1;
      expect(await has()).toBe(true);
      migrateIso('down', MIGRATION_FILES.length);
      expect(await has()).toBe(false);
      const role = await iso.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sf_cmp006_rw'`);
      expect(role.rows).toHaveLength(1);
      migrateIso('up');
      expect(await has()).toBe(true);
    });
  });
});
