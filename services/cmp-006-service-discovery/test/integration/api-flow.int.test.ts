import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgDiscoveryRepository } from '../../src/repo/pg.js';
import {
  BIND_1,
  CATALOGUE_A,
  CATALOGUE_B,
  CITIZEN_2,
  ctxFor,
  JUR_CHILD,
  queryBody,
  SVC_1,
  SVC_2,
  SVC_3,
  SVC_B1,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness as ApiHarness } from '../doubles/harness.js';
import {
  asSqlPool,
  closeHarness,
  resetData,
  setupHarness,
  T1,
  T2,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const Q = '/v1/discovery/queries';

describe('CMP-006 API over PostgreSQL (real LOGIN role, FORCE RLS)', () => {
  let db: Harness;
  let h: ApiHarness;

  beforeAll(async () => {
    expect(T1).toBe(TENANT_A);
    expect(T2).toBe(TENANT_B);
    db = await setupHarness();
  }, 180_000);

  beforeEach(async () => {
    await resetData(db.admin);
    h = makeHarness(new PgDiscoveryRepository(asSqlPool(db.rt)));
  });

  afterAll(async () => {
    await closeHarness(db);
  });

  const COUNT_SQL = {
    discovery_query:
      'SELECT count(*)::int AS n FROM sf_discovery.discovery_query WHERE tenant_id = $1',
    discovery_result:
      'SELECT count(*)::int AS n FROM sf_discovery.discovery_result WHERE tenant_id = $1',
    discovery_selection:
      'SELECT count(*)::int AS n FROM sf_discovery.discovery_selection WHERE tenant_id = $1',
  } as const;

  async function count(table: keyof typeof COUNT_SQL, tenant: string): Promise<number> {
    const r = await db.admin.query<{ n: number }>(COUNT_SQL[table], [tenant]);
    return r.rows[0]?.n ?? -1;
  }

  async function events(
    tenant: string,
  ): Promise<{ topic: string; event_type: string; envelope: Body }[]> {
    const r = await db.admin.query<{ topic: string; event_type: string; envelope: Body }>(
      `SELECT topic, event_type, envelope FROM sf_discovery.outbox_event WHERE tenant_id = $1 ORDER BY seq`,
      [tenant],
    );
    return r.rows;
  }

  it('query persists log + results + event + audit atomically; no keyword text reaches the database', async () => {
    const res = await h.call(
      'POST',
      Q,
      queryBody({ filters: { jurisdiction_codes: [JUR_CHILD], keywords: ['certificate'] } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as Body;
    expect(body['results'].map((r: Body) => r['service_id'])).toEqual([SVC_1, SVC_3]);
    expect(await count('discovery_query', T1)).toBe(1);
    expect(await count('discovery_result', T1)).toBe(2);
    const ev = await events(T1);
    expect(ev.map((e) => e.event_type)).toEqual(['DiscoveryQueryExecuted', 'AuditEventSubmitted']);
    const dump = await db.admin.query<{ t: string }>(
      `SELECT (SELECT coalesce(json_agg(q), '[]')::text FROM sf_discovery.discovery_query q)
           || (SELECT coalesce(json_agg(o.envelope), '[]')::text FROM sf_discovery.outbox_event o) AS t`,
    );
    expect(dump.rows[0]?.t).not.toContain('certificate');
    const stored = await h.call('GET', `${Q}/${body['query']['query_id']}`);
    expect(stored.status).toBe(200);
    expect((stored.body as Body)['results']).toEqual(
      body['results'].map((r: Body) => ({ ...r, label: null })),
    );
  });

  it('tenant B sees only its own services and cannot read tenant A queries', async () => {
    const a = (await h.call('POST', Q, queryBody())).body as Body;
    h.state.ctx = ctxFor(TENANT_B);
    const b = await h.call('POST', Q, queryBody({ catalogue_version_id: CATALOGUE_B }));
    expect((b.body as Body)['results'].map((r: Body) => r['service_id'])).toEqual([SVC_B1]);
    expect((await h.call('GET', `${Q}/${a['query']['query_id']}`)).status).toBe(404);
    expect(
      (await h.call('POST', `${Q}/${a['query']['query_id']}/selections`, { service_id: SVC_1 }))
        .status,
    ).toBe(404);
    expect(await count('discovery_query', T2)).toBe(1);
    expect(await count('discovery_selection', T1)).toBe(0);
  });

  it('a leaked cross-tenant search hit is blocked before anything is persisted', async () => {
    h.search.extra = [{ tenant_id: TENANT_B, service_id: SVC_B1 }];
    const res = await h.call('POST', Q, queryBody());
    expect(res.status).toBe(403);
    expect(await count('discovery_query', T1)).toBe(0);
    const ev = await events(T1);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.envelope['data']).toMatchObject({
      action: 'DISCOVERY_QUERY',
      result: 'FAILED',
      reason: 'CROSS_TENANT_RESULT_BLOCKED',
    });
  });

  it('INT-003: selection is idempotent, owner-only, pinned, and the only draft-intent signal', async () => {
    const q = (await h.call('POST', Q, queryBody())).body as Body;
    const path = `${Q}/${q['query']['query_id']}/selections`;
    expect(await count('discovery_selection', T1)).toBe(0);
    const first = await h.call('POST', path, { service_id: SVC_1 }, { key: 'it-sel-00000001' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      service_binding_version_id: BIND_1,
      catalogue_version_id: CATALOGUE_A,
      draft_created: false,
    });
    const replay = await h.call('POST', path, { service_id: SVC_1 }, { key: 'it-sel-00000001' });
    expect(replay.body).toEqual(first.body);
    const dup = await h.call('POST', path, { service_id: SVC_1 }, { key: 'it-sel-00000002' });
    expect(dup.status).toBe(409);
    const notResult = await h.call('POST', path, { service_id: SVC_2 });
    expect(notResult.status).toBe(409);
    h.state.ctx = ctxFor(TENANT_A, CITIZEN_2);
    expect((await h.call('POST', path, { service_id: SVC_3 })).status).toBe(404);
    expect(await count('discovery_selection', T1)).toBe(1);
    const selected = (await events(T1)).filter((e) => e.event_type === 'DiscoveryServiceSelected');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.envelope['data']).toMatchObject({
      service_id: SVC_1,
      service_binding_version_id: BIND_1,
      result_is_non_statutory: true,
      draft_created: false,
    });
  });

  it('a failed port leaves only the FAILED audit row', async () => {
    h.search.fail = true;
    const res = await h.call('POST', Q, queryBody());
    expect(res.status).toBe(503);
    expect(await count('discovery_query', T1)).toBe(0);
    expect((await events(T1)).map((e) => e.event_type)).toEqual(['AuditEventSubmitted']);
  });
});
