import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { isSearchDocument } from '../../src/domain/document.js';
import { SearchIndexConsumer } from '../../src/indexer.js';
import { denyAllAuthorization } from '../../src/ports/authorization.js';
import { SimulatedProjectionRules } from '../../src/ports/projection-rules.js';
import { SearchQueryService, type SearchHit } from '../../src/service.js';
import { ContractAuthorizer } from '../doubles/authorizer.js';
import { ctx, INDEXER, RULE, SOURCE_TOPIC, T1, T2, sourceEvent } from '../doubles/fixtures.js';
import { MemorySearchStore } from '../doubles/memory-store.js';

interface QueryBody {
  hits: SearchHit[];
  next_cursor: string | null;
}

async function seeded() {
  const store = new MemorySearchStore();
  const indexer = new SearchIndexConsumer({
    store,
    rules: new SimulatedProjectionRules([RULE]),
    indexerActorId: INDEXER,
    config: { environment: 'CI' },
  });
  const shared = '88888888-8888-4888-8888-888888888888';
  for (const tenant of [T1, T2]) {
    await indexer.ingest({
      topic: SOURCE_TOPIC,
      envelope: sourceEvent({ tenant, aggregateId: shared }),
    });
    for (let i = 0; i < 3; i += 1) {
      await indexer.ingest({ topic: SOURCE_TOPIC, envelope: sourceEvent({ tenant }) });
    }
  }
  await indexer.ingest({
    topic: SOURCE_TOPIC,
    envelope: sourceEvent({ tenant: T1, data: { service_code: 'OTHER', state: 'APPROVED' } }),
  });
  await indexer.ingest({
    topic: SOURCE_TOPIC,
    envelope: sourceEvent({ tenant: T1, eventType: 'CaseWithdrawn', data: {} }),
  });
  const authorizer = new ContractAuthorizer();
  const service = new SearchQueryService({ store, authorizer, config: { environment: 'CI' } });
  return { store, authorizer, service, shared };
}

describe('SearchQueryService tenant isolation (INT-011)', () => {
  it('returns only the caller tenant hits: CROSS_TENANT_LEAKAGE = 0', async () => {
    const { service } = await seeded();
    let leakage = 0;
    for (const tenant of [T1, T2]) {
      const res = await service.query(ctx(tenant), { facets: { state: 'SUBMITTED' } });
      const body = res.body as QueryBody;
      expect(body.hits.length).toBe(4);
      leakage += body.hits.filter((h) => h.document.tenant_id !== tenant).length;
      for (const h of body.hits) expect(isSearchDocument(h.document)).toBe(true);
    }
    expect(leakage).toBe(0);
  });

  it('blocks results if the isolation layer ever returns another tenant row', async () => {
    const { store, service } = await seeded();
    store.bypassTenantFilter = true;
    await expect(service.query(ctx(T1), {})).rejects.toMatchObject({
      code: 'SF-TEN-002',
      details: [{ code: 'CROSS_TENANT_RESULT_BLOCKED' }],
    });
  });

  it('the tenant cannot be supplied in the query body', async () => {
    const { service } = await seeded();
    await expect(service.query(ctx(T1), { tenant_id: T2 })).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
  });

  it('getDocument hides other tenants and removed documents', async () => {
    const { service, store } = await seeded();
    const t2Doc = store.state.documents.find((d) => d.tenant_id === T2);
    const removed = store.state.documents.find((d) => d.status === 'REMOVED');
    const t1Doc = store.state.documents.find((d) => d.tenant_id === T1 && d.status === 'ACTIVE');
    await expect(service.getDocument(ctx(T1), t2Doc?.document_id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    await expect(service.getDocument(ctx(T1), removed?.document_id)).rejects.toMatchObject({
      code: 'SF-SYS-002',
    });
    const ok = await service.getDocument(ctx(T1), t1Doc?.document_id.toUpperCase());
    expect((ok.body as { hit: SearchHit }).hit.document.document_id).toBe(t1Doc?.document_id);
    store.bypassTenantFilter = true;
    await expect(service.getDocument(ctx(T1), t2Doc?.document_id)).rejects.toMatchObject({
      code: 'SF-TEN-002',
    });
  });
});

describe('SearchQueryService queries', () => {
  it('filters by facets and source component and excludes removed documents', async () => {
    const { service } = await seeded();
    const all = (await service.query(ctx(T1), {})).body as QueryBody;
    expect(all.hits).toHaveLength(5);
    const other = (await service.query(ctx(T1), { facets: { service_code: 'OTHER' } }))
      .body as QueryBody;
    expect(other.hits.map((h) => h.document.facets['state'])).toEqual(['APPROVED']);
    const none = (await service.query(ctx(T1), { source_cmp_id: 'CMP-027' })).body as QueryBody;
    expect(none.hits).toEqual([]);
  });

  it('pages with a keyset cursor', async () => {
    const { service } = await seeded();
    const first = (await service.query(ctx(T1), { limit: 2 })).body as QueryBody;
    expect(first.hits).toHaveLength(2);
    expect(first.next_cursor).toBe(first.hits[1]?.document.document_id);
    const second = (await service.query(ctx(T1), { limit: 2, after: first.next_cursor }))
      .body as QueryBody;
    const third = (await service.query(ctx(T1), { limit: 2, after: second.next_cursor }))
      .body as QueryBody;
    expect(third.hits).toHaveLength(1);
    expect(third.next_cursor).toBeNull();
    const ids = [...first.hits, ...second.hits, ...third.hits].map((h) => h.document.document_id);
    expect(new Set(ids).size).toBe(5);
  });

  it('hits carry source identity, source version and projection pin', async () => {
    const { service, shared } = await seeded();
    const body = (await service.query(ctx(T1), {})).body as QueryBody;
    const hit = body.hits.find((h) => h.document.source_record_id === shared);
    expect(hit).toMatchObject({
      document: { source_cmp_id: 'CMP-015', tenant_id: T1 },
      source: { aggregate_type: 'ApplicationCase', version: 1, event_type: 'CaseSubmitted' },
      projection: { rule_id: RULE.rule_id, rule_version: RULE.rule_version },
      revision: 1,
    });
  });
});

describe('SearchQueryService authorization and context', () => {
  it('asks the PDP with subject tenant = resource tenant', async () => {
    const { service, authorizer } = await seeded();
    await service.query(ctx(T1), {});
    expect(authorizer.inputs[0]).toMatchObject({
      action: 'SEARCH_DOCUMENT_QUERY',
      subject: { tenant_id: T1 },
      resource: { tenant_id: T1, resource_type: 'SearchDocument', classification: 'TENANT_SCOPED' },
    });
  });

  it('denies, fails closed on PDP outage and on malformed decisions', async () => {
    const { service, authorizer } = await seeded();
    authorizer.denied.add('SEARCH_DOCUMENT_QUERY');
    await expect(service.query(ctx(T1), {})).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    authorizer.denied.clear();
    authorizer.failWith = new Error('opa down');
    await expect(service.query(ctx(T1), {})).rejects.toMatchObject({ code: 'SF-SYS-004' });
    authorizer.failWith = null;
    authorizer.malformed = true;
    await expect(service.getDocument(ctx(T1), T1)).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('default-deny authorization port', async () => {
    const service = new SearchQueryService({
      store: new MemorySearchStore(),
      authorizer: denyAllAuthorization(),
      config: { environment: 'PRODUCTION' },
    });
    await expect(service.query(ctx(T1), {})).rejects.toMatchObject({ code: 'SF-AUTH-002' });
  });

  it('requires a verified tenant context', async () => {
    const { service } = await seeded();
    await expect(service.query(undefined, {})).rejects.toMatchObject({ code: 'SF-AUTH-001' });
    await expect(service.query({ tenant_id: T1 }, {})).rejects.toMatchObject({
      code: 'SF-AUTH-001',
    });
    await expect(service.query({ ...ctx(T1), tenant_id: null }, {})).rejects.toMatchObject({
      code: 'SF-TEN-001',
      statusCode: 401,
    });
    await expect(service.getDocument(ctx(T1), 'nope')).rejects.toMatchObject({
      code: 'SF-SYS-003',
    });
  });

  it('refuses a SIMULATED authorizer in PRODUCTION', () => {
    const authorizer = Object.assign(new ContractAuthorizer(), { simulation: 'SIMULATED' });
    expect(
      () =>
        new SearchQueryService({
          store: new MemorySearchStore(),
          authorizer,
          config: { environment: 'PRODUCTION' },
        }),
    ).toThrow(
      expect.objectContaining({
        details: [{ code: 'AUTHORIZATION_PRODUCTION_SIMULATED_FORBIDDEN' }],
      }),
    );
  });

  it('loadConfig validates SF_ENVIRONMENT', () => {
    expect(loadConfig({})).toEqual({ environment: 'LOCAL' });
    expect(loadConfig({ SF_ENVIRONMENT: 'UAT' })).toEqual({ environment: 'UAT' });
    expect(() => loadConfig({ SF_ENVIRONMENT: 'MARS' })).toThrow(
      expect.objectContaining({ details: [{ code: 'SF_ENVIRONMENT_INVALID' }] }),
    );
  });
});
