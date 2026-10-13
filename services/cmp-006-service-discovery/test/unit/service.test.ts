import { describe, expect, it } from 'vitest';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  BIND_1,
  CATALOGUE_A,
  CATALOGUE_A_DRAFT,
  CATALOGUE_B,
  CITIZEN_1,
  CITIZEN_2,
  ctxFor,
  JUR_CHILD,
  JUR_OTHER,
  OFFICER_1,
  queryBody,
  SVC_1,
  SVC_2,
  SVC_3,
  SVC_B1,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import type { MemoryDiscoveryRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const Q = '/v1/discovery/queries';

function store(h: Harness, tenant = TENANT_A) {
  return (h.repo as MemoryDiscoveryRepository).tenant(tenant);
}

function audits(h: Harness, tenant = TENANT_A): Body[] {
  return store(h, tenant)
    .outbox.filter((o) => o.topic === TOPIC_AUDIT)
    .map((o) => o.envelope.data as Body);
}

function domainEvents(h: Harness, tenant = TENANT_A): string[] {
  return store(h, tenant)
    .outbox.filter((o) => o.topic === TOPIC_DOMAIN)
    .map((o) => o.envelope.event_type);
}

async function runQuery(h: Harness, over: Record<string, unknown> = {}): Promise<Body> {
  const res = await h.call('POST', Q, queryBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
}

describe('discovery query (jurisdiction-aware, catalogue pinned)', () => {
  it('returns services available in the requested jurisdiction or an enclosing one', async () => {
    const h = makeHarness();
    const body = await runQuery(h, { locale: 'en-IN' });
    expect(body['results'].map((r: Body) => r['service_id'])).toEqual([SVC_1, SVC_3]);
    expect(body['results'][0]).toEqual({
      rank: 1,
      service_id: SVC_1,
      service_code: 'SVC_SYNTHETIC_01',
      category_code: 'CAT_SYNTHETIC',
      service_binding_version_id: BIND_1,
      catalogue_version_id: CATALOGUE_A,
      matched_jurisdiction_codes: ['JUR-P'],
      label: '[en-IN] svc.SVC_SYNTHETIC_01.name',
    });
    expect(body['query']['tenant_id']).toBe(TENANT_A);
    expect(body['query']['result_is_non_statutory']).toBe(true);
    expect(body['result_is_non_statutory']).toBe(true);
    expect(body['draft_created']).toBe(false);
    expect(body['localization_status']).toBe('RESOLVED');
    expect(body['pagination']).toEqual({ limit: 20, offset: 0, next_offset: null });
    expect(h.search.calls[0]).toMatchObject({
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      jurisdictionCodes: ['JUR-P', 'JUR-P-01'],
      limit: 21,
      offset: 0,
    });
    expect(domainEvents(h)).toEqual(['DiscoveryQueryExecuted']);
    expect(audits(h)).toMatchObject([{ action: 'DISCOVERY_QUERY', result: 'SUCCESS' }]);
  });

  it('a jurisdiction with no applicable services yields an empty, still non-statutory result', async () => {
    const h = makeHarness();
    const body = await runQuery(h, { filters: { jurisdiction_codes: [JUR_OTHER] } });
    expect(body['results'].map((r: Body) => r['service_id'])).toEqual([SVC_2]);
    const none = await runQuery(h, {
      filters: { jurisdiction_codes: [JUR_OTHER], service_codes: ['SVC_SYNTHETIC_01'] },
    });
    expect(none['results']).toEqual([]);
    expect(none['result_is_non_statutory']).toBe(true);
  });

  it('keywords narrow results but are never persisted or emitted', async () => {
    const h = makeHarness();
    const body = await runQuery(h, {
      filters: { jurisdiction_codes: [JUR_CHILD], keywords: ['gamma'] },
    });
    expect(body['results'].map((r: Body) => r['service_id'])).toEqual([SVC_3]);
    expect(body['query']['filters']['keywords']).toEqual(['gamma']);
    const s = store(h);
    const persisted = JSON.stringify({
      q: [...s.queries.values()],
      r: s.results,
      o: s.outbox,
    });
    expect(persisted).not.toContain('gamma');
    expect([...s.queries.values()][0]?.keyword_count).toBe(1);
  });

  it('paginates via the search port (limit+1 probe) and reports next_offset', async () => {
    const h = makeHarness();
    const first = await runQuery(h, { pagination: { limit: 1, offset: 0 } });
    expect(first['results'].map((r: Body) => r['service_id'])).toEqual([SVC_1]);
    expect(first['pagination']).toEqual({ limit: 1, offset: 0, next_offset: 1 });
    const second = await runQuery(h, { pagination: { limit: 1, offset: 1 } });
    expect(second['results'].map((r: Body) => r['service_id'])).toEqual([SVC_3]);
    expect(second['pagination']['next_offset']).toBeNull();
  });

  it('stale index candidates are dropped and counted, never guessed at', async () => {
    const h = makeHarness();
    h.search.extra = [{ tenant_id: TENANT_A, service_id: 'c9999999-9999-4999-8999-999999999999' }];
    const body = await runQuery(h);
    expect(body['results']).toHaveLength(2);
    expect(body['excluded_count']).toBe(1);
  });

  it('unpublished or unknown catalogue pins and unknown jurisdictions fail closed and are audited', async () => {
    const h = makeHarness();
    const draft = await h.call('POST', Q, queryBody({ catalogue_version_id: CATALOGUE_A_DRAFT }));
    expect(draft.status).toBe(409);
    expect((draft.body as Body)['details']).toEqual([
      { code: 'CATALOGUE_VERSION_NOT_PUBLISHED', pointer: '/catalogue_version_id' },
    ]);
    const unknown = await h.call(
      'POST',
      Q,
      queryBody({ catalogue_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
    );
    expect(unknown.status).toBe(404);
    const jur = await h.call(
      'POST',
      Q,
      queryBody({ filters: { jurisdiction_codes: ['JUR-NONE'] } }),
    );
    expect(jur.status).toBe(400);
    expect((jur.body as Body)['details'][0]['code']).toBe('JURISDICTION_CODE_UNKNOWN');
    expect(h.search.calls).toHaveLength(0);
    expect(store(h).queries.size).toBe(0);
    expect(audits(h).map((a) => [a['result'], a['reason']])).toEqual([
      ['FAILED', 'CATALOGUE_VERSION_NOT_PUBLISHED'],
      ['FAILED', 'CATALOGUE_VERSION_NOT_FOUND'],
      ['FAILED', 'JURISDICTION_CODE_UNKNOWN'],
    ]);
  });

  it('localization outage degrades to codes; it never fails the query', async () => {
    const h = makeHarness();
    h.localization.fail = true;
    const body = await runQuery(h, { locale: 'hi' });
    expect(body['localization_status']).toBe('UNAVAILABLE');
    expect(body['results'].every((r: Body) => r['label'] === null)).toBe(true);
    const noLocale = await runQuery(h);
    expect(noLocale['localization_status']).toBe('NOT_REQUESTED');
  });

  it('catalogue, jurisdiction and search outages or malformed answers fail closed (503)', async () => {
    for (const [arrange, code] of [
      [(h: Harness) => (h.catalogue.fail = true), 'CATALOGUE_UNAVAILABLE'],
      [(h: Harness) => (h.jurisdictions.fail = true), 'JURISDICTION_UNAVAILABLE'],
      [(h: Harness) => (h.search.fail = true), 'SEARCH_UNAVAILABLE'],
      [
        (h: Harness) =>
          (h.search.extra = [{ tenant_id: TENANT_A, service_id: 'not-a-uuid' }] as never),
        'SEARCH_RESPONSE_INVALID',
      ],
    ] as const) {
      const h = makeHarness();
      arrange(h);
      const res = await h.call('POST', Q, queryBody());
      expect(res.status, code).toBe(503);
      expect((res.body as Body)['error_code']).toBe('SF-INT-001');
      expect((res.body as Body)['details'], code).toEqual([{ code }]);
      expect(store(h).queries.size).toBe(0);
      expect(audits(h)[0]).toMatchObject({ result: 'FAILED', reason: code });
    }
  });

  it('no port is ever called while a database transaction is open', async () => {
    const h = makeHarness();
    const seen: boolean[] = [];
    h.search.onSearch = () => seen.push(h.repo.inTransaction());
    await runQuery(h);
    expect(seen).toEqual([false]);
  });

  it('state, results, event and audit commit together or not at all', async () => {
    const h = makeHarness();
    (h.repo as MemoryDiscoveryRepository).failNextCommit = true;
    const res = await h.call('POST', Q, queryBody());
    expect(res.status).toBe(500);
    const s = store(h);
    expect(s.queries.size).toBe(0);
    expect(s.results).toEqual([]);
    expect(s.outbox).toEqual([]);
  });
});

describe('tenant isolation (INT-011)', () => {
  it('each tenant only ever sees its own catalogue services', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_B);
    const b = await runQuery(h, { catalogue_version_id: CATALOGUE_B });
    expect(b['results'].map((r: Body) => r['service_id'])).toEqual([SVC_B1]);
    expect(b['query']['tenant_id']).toBe(TENANT_B);
    h.state.ctx = ctxFor(TENANT_A);
    const pinB = await h.call('POST', Q, queryBody({ catalogue_version_id: CATALOGUE_B }));
    expect(pinB.status).toBe(404);
    expect(store(h, TENANT_A).queries.size).toBe(0);
  });

  it('a leaked foreign-tenant search hit, entry or pin aborts the query (403) and is audited', async () => {
    for (const arrange of [
      (h: Harness) => (h.search.extra = [{ tenant_id: TENANT_B, service_id: SVC_B1 }]),
      (h: Harness) => {
        h.catalogue.leakEntries = true;
        h.search.extra = [{ tenant_id: TENANT_A, service_id: SVC_B1 }];
      },
      (h: Harness) => (h.catalogue.leakVersion = true),
    ]) {
      const h = makeHarness();
      arrange(h);
      const body = h.catalogue.leakVersion
        ? queryBody({ catalogue_version_id: CATALOGUE_B })
        : queryBody();
      const res = await h.call('POST', Q, body);
      expect(res.status).toBe(403);
      expect((res.body as Body)['details']).toEqual([{ code: 'CROSS_TENANT_RESULT_BLOCKED' }]);
      expect(store(h).queries.size).toBe(0);
      expect(audits(h)[0]).toMatchObject({
        result: 'FAILED',
        reason: 'CROSS_TENANT_RESULT_BLOCKED',
      });
    }
  });

  it('tenant headers, body tenant_id, missing context and tenant-less context are refused', async () => {
    const h = makeHarness();
    const hdr = await h.call('POST', Q, queryBody(), { headers: { 'X-Tenant-Id': TENANT_B } });
    expect(hdr.status).toBe(403);
    const fwd = await h.call('POST', Q, queryBody(), {
      headers: { forwarded: `tenant=${TENANT_B}` },
    });
    expect(fwd.status).toBe(403);
    const body = await h.call('POST', Q, queryBody({ tenant_id: TENANT_B }));
    expect(body.status).toBe(403);
    h.state.ctx = null;
    expect((await h.call('POST', Q, queryBody())).status).toBe(401);
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    const noTenant = await h.call('POST', Q, queryBody());
    expect((noTenant.body as Body)['error_code']).toBe('SF-TEN-001');
    expect(h.search.calls).toHaveLength(0);
  });

  it('a stored query of tenant A is invisible to tenant B', async () => {
    const h = makeHarness();
    const a = await runQuery(h);
    h.state.ctx = ctxFor(TENANT_B);
    const res = await h.call('GET', `${Q}/${a['query']['query_id']}`);
    expect(res.status).toBe(404);
  });
});

describe('authorization (OPA PEP, fail closed)', () => {
  it('a PDP denial is audited DENIED and no port is called', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions.add('DISCOVERY_QUERY');
    const res = await h.call('POST', Q, queryBody());
    expect(res.status).toBe(403);
    expect(audits(h)).toMatchObject([{ action: 'DISCOVERY_QUERY', result: 'DENIED' }]);
    expect(h.catalogue.calls).toBe(0);
  });

  it('PDP outage is 503 and integrations have no discovery surface', async () => {
    const h = makeHarness();
    h.authorizer.fail = true;
    const down = await h.call('POST', Q, queryBody());
    expect(down.status).toBe(503);
    expect((down.body as Body)['details']).toEqual([{ code: 'PDP_UNAVAILABLE' }]);
    h.authorizer.fail = false;
    h.state.ctx = ctxFor(TENANT_A, OFFICER_1, 'INTEGRATION');
    const integ = await h.call('POST', Q, queryBody());
    expect(integ.status).toBe(403);
    expect((integ.body as Body)['details']).toEqual([{ code: 'ACTOR_NOT_PERMITTED' }]);
  });

  it('routing: unknown path 404, wrong method 400, client time in query string refused', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/discovery/other')).status).toBe(404);
    expect((await h.call('GET', Q)).status).toBe(400);
    const t = await h.call('POST', Q, queryBody(), { query: { now: '2020-01-01' } });
    expect((t.body as Body)['details'][0]['code']).toBe('CLIENT_TIME_NOT_AUTHORITATIVE');
  });
});

describe('stored query read', () => {
  it('owner and staff can read; another citizen cannot; keywords are not returned', async () => {
    const h = makeHarness();
    const a = await runQuery(h, {
      filters: { jurisdiction_codes: [JUR_CHILD], keywords: ['alpha'] },
    });
    const id = a['query']['query_id'] as string;
    const own = await h.call('GET', `${Q}/${id}`);
    expect(own.status).toBe(200);
    expect((own.body as Body)['query']['filters']).toEqual({ jurisdiction_codes: [JUR_CHILD] });
    expect((own.body as Body)['keyword_count']).toBe(1);
    expect((own.body as Body)['results'].map((r: Body) => r['service_id'])).toEqual([SVC_1]);
    h.state.ctx = ctxFor(TENANT_A, CITIZEN_2);
    expect((await h.call('GET', `${Q}/${id}`)).status).toBe(404);
    h.state.ctx = ctxFor(TENANT_A, OFFICER_1, 'OFFICER');
    expect((await h.call('GET', `${Q}/${id}`)).status).toBe(200);
    expect((await h.call('GET', `${Q}/not-a-uuid`)).status).toBe(400);
  });
});

describe('INT-003 hand-off: non-mutating until the citizen acts', () => {
  it('running queries never records a selection or a draft intent', async () => {
    const h = makeHarness();
    await runQuery(h);
    await runQuery(h, { filters: { jurisdiction_codes: [JUR_OTHER] } });
    expect(store(h).selections).toEqual([]);
    expect(domainEvents(h)).not.toContain('DiscoveryServiceSelected');
  });

  it('the owning citizen selects a result; the event carries catalogue and binding pins', async () => {
    const h = makeHarness();
    const a = await runQuery(h);
    const id = a['query']['query_id'] as string;
    const res = await h.call(
      'POST',
      `${Q}/${id}/selections`,
      { service_id: SVC_1 },
      { key: 'sel-key-0001' },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      query_id: id,
      service_id: SVC_1,
      service_binding_version_id: BIND_1,
      catalogue_version_id: CATALOGUE_A,
      result_is_non_statutory: true,
      draft_created: false,
    });
    const ev = store(h).outbox.find((o) => o.envelope.event_type === 'DiscoveryServiceSelected');
    expect(ev?.envelope.data).toMatchObject({
      service_binding_version_id: BIND_1,
      catalogue_version_id: CATALOGUE_A,
      draft_created: false,
    });
    expect(ev?.envelope.actor).toEqual({ type: 'CITIZEN', id: CITIZEN_1 });

    const replay = await h.call(
      'POST',
      `${Q}/${id}/selections`,
      { service_id: SVC_1 },
      { key: 'sel-key-0001' },
    );
    expect(replay).toEqual(res);
    const conflict = await h.call(
      'POST',
      `${Q}/${id}/selections`,
      { service_id: SVC_3 },
      { key: 'sel-key-0001' },
    );
    expect(conflict.status).toBe(409);
    const dup = await h.call(
      'POST',
      `${Q}/${id}/selections`,
      { service_id: SVC_1 },
      { key: 'sel-key-0002' },
    );
    expect(dup.status).toBe(409);
    expect((dup.body as Body)['error_code']).toBe('SF-APP-002');
    expect(store(h).selections).toHaveLength(1);
    expect(domainEvents(h).filter((e) => e === 'DiscoveryServiceSelected')).toHaveLength(1);
  });

  it('a service that was not in the results cannot be selected (audited)', async () => {
    const h = makeHarness();
    const a = await runQuery(h);
    const res = await h.call('POST', `${Q}/${a['query']['query_id']}/selections`, {
      service_id: SVC_2,
    });
    expect(res.status).toBe(409);
    expect((res.body as Body)['details']).toEqual([{ code: 'SERVICE_NOT_IN_RESULTS' }]);
    expect(audits(h).at(-1)).toMatchObject({
      action: 'DISCOVERY_SERVICE_SELECT',
      result: 'FAILED',
      reason: 'SERVICE_NOT_IN_RESULTS',
    });
  });

  it('only the citizen who ran the query may select; staff cannot act for them here', async () => {
    const h = makeHarness();
    const a = await runQuery(h);
    const path = `${Q}/${a['query']['query_id']}/selections`;
    h.state.ctx = ctxFor(TENANT_A, CITIZEN_2);
    expect((await h.call('POST', path, { service_id: SVC_1 })).status).toBe(404);
    h.state.ctx = ctxFor(TENANT_A, OFFICER_1, 'OFFICER');
    const officer = await h.call('POST', path, { service_id: SVC_1 });
    expect(officer.status).toBe(403);
    expect((officer.body as Body)['details']).toEqual([{ code: 'ACTOR_NOT_PERMITTED' }]);
    h.state.ctx = ctxFor(TENANT_B);
    expect((await h.call('POST', path, { service_id: SVC_1 })).status).toBe(404);
    expect(store(h).selections).toEqual([]);
  });

  it('selection needs an idempotency key and a still-published catalogue pin', async () => {
    const h = makeHarness();
    const a = await runQuery(h);
    const path = `${Q}/${a['query']['query_id']}/selections`;
    const noKey = await h.call('POST', path, { service_id: SVC_1 }, { key: null });
    expect((noKey.body as Body)['details']).toEqual([{ code: 'IDEMPOTENCY_KEY_REQUIRED' }]);
    h.catalogue.versions = h.catalogue.versions.map((v) =>
      v.catalogue_version_id === CATALOGUE_A ? { ...v, status: 'RETIRED' as const } : v,
    );
    const retired = await h.call('POST', path, { service_id: SVC_1 });
    expect(retired.status).toBe(409);
    expect((retired.body as Body)['details'][0]['code']).toBe('CATALOGUE_VERSION_NOT_PUBLISHED');
    expect(store(h).selections).toEqual([]);
  });
});
