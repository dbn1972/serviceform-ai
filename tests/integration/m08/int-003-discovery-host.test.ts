import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import { buildServiceDiscoveryService } from '../../../services/cmp-006-service-discovery/src/index.js';
import {
  CANARY,
  CITIZEN_1,
  CITIZEN_2,
  config,
  ContextState,
  ctxFor,
  expectForgedTenantDenied,
  must,
  OFFICER_1,
  RecordingAuthorizer,
  silentLogger,
  T1,
  T2,
} from './support/fixtures.js';
import {
  BIND_T1_A,
  CAT_T1,
  CAT_T1_DRAFT,
  CAT_T2,
  InMemoryDiscoveryRepository,
  JUR_DISTRICT,
  StubCatalogue,
  StubJurisdictions,
  StubSearch,
  SVC_T1_A,
  SVC_T1_B,
  SVC_T2_A,
} from './support/discovery-doubles.js';

/**
 * INT-003 discovery → selection intent through the real API host (CMP-036 + M08 composition)
 * into the real CMP-006 service. Only the persistence and peer read ports are doubles.
 */
let app: FastifyInstance | undefined;
let repo: InMemoryDiscoveryRepository;
let state: ContextState;
let authorizer: RecordingAuthorizer;
let search: StubSearch;
let keySeq = 0;

function host(): FastifyInstance {
  return must(app, 'app');
}

function queryBody(over: Record<string, unknown> = {}) {
  return {
    filters: { jurisdiction_codes: [JUR_DISTRICT] },
    catalogue_version_id: CAT_T1,
    pagination: { limit: 20, offset: 0 },
    ...over,
  };
}

function nextKey(): string {
  keySeq += 1;
  return `int-m08-key-${String(keySeq).padStart(6, '0')}`;
}

async function runQuery(body: Record<string, unknown> = queryBody()) {
  return host().inject({ method: 'POST', url: '/v1/discovery/queries', payload: body });
}

async function select(queryId: string, serviceId: string, key: string | null = nextKey()) {
  return host().inject({
    method: 'POST',
    url: `/v1/discovery/queries/${queryId}/selections`,
    headers: key === null ? {} : { 'idempotency-key': key },
    payload: { service_id: serviceId },
  });
}

beforeEach(async () => {
  repo = new InMemoryDiscoveryRepository();
  state = new ContextState(ctxFor(T1, CITIZEN_1, 'CITIZEN'));
  authorizer = new RecordingAuthorizer();
  search = new StubSearch();
  const service = buildServiceDiscoveryService({
    repository: repo,
    authorizer,
    catalogue: new StubCatalogue(),
    jurisdictions: new StubJurisdictions(),
    search,
    clock: () => new Date('2026-10-13T10:00:00Z'),
  });
  app = await buildApp(config, {
    logger: silentLogger(),
    m08: { discovery: { service, resolveContext: state.resolve } },
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-003 discovery path via API host → CMP-006', () => {
  it('host mounts CMP-006 only and query returns pinned, non-statutory results', async () => {
    expect(host().m08Mounted).toEqual(['CMP-006']);
    const res = await runQuery();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result_is_non_statutory).toBe(true);
    expect(body.draft_created).toBe(false);
    expect(body.query.catalogue_version_id).toBe(CAT_T1);
    const ids = body.results.map((r: { service_id: string }) => r.service_id);
    expect(ids).toEqual([SVC_T1_A]);
    expect(ids).not.toContain(SVC_T1_B);
    expect(body.results[0].service_binding_version_id).toBe(BIND_T1_A);
  });

  it('authorization input is built from server context (tenant/actor), never request data', async () => {
    await runQuery();
    expect(authorizer.calls.length).toBeGreaterThan(0);
    for (const c of authorizer.calls) {
      expect(c.subject.tenant_id).toBe(T1);
      expect(c.resource.tenant_id).toBe(T1);
      expect(c.subject.actor_type).toBe('CITIZEN');
    }
  });

  it('selection is the single INT-003 hand-off: intent event only, no draft, contract envelopes', async () => {
    const q = (await runQuery()).json();
    const res = await select(q.query.query_id, SVC_T1_A);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      service_id: SVC_T1_A,
      service_binding_version_id: BIND_T1_A,
      catalogue_version_id: CAT_T1,
      result_is_non_statutory: true,
      draft_created: false,
    });

    const t1 = repo.store.tenant(T1);
    expect(t1.selections).toHaveLength(1);
    const domain = t1.outbox.filter((o) => o.topic === 'sf.discovery.events.v1');
    expect(domain.map((o) => o.envelope.event_type)).toEqual([
      'DiscoveryQueryExecuted',
      'DiscoveryServiceSelected',
    ]);
    const selected = must(domain[1]).envelope;
    expect(selected.data).toMatchObject({ draft_created: false, result_is_non_statutory: true });
    for (const row of t1.outbox) {
      expect(validate('event-envelope', row.envelope).valid, row.envelope.event_type).toBe(true);
      expect(row.envelope.tenant_id).toBe(T1);
    }
    const audits = t1.outbox.filter((o) => o.topic === 'sf.audit.ingest.v1');
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const a of audits) {
      expect(validate('audit-event', a.envelope.data).valid).toBe(true);
    }
  });

  it('selection replays idempotently and requires an Idempotency-Key', async () => {
    const q = (await runQuery()).json();
    const missing = await select(q.query.query_id, SVC_T1_A, null);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error_code: 'SF-SYS-003' });

    const key = nextKey();
    const first = await select(q.query.query_id, SVC_T1_A, key);
    const replay = await select(q.query.query_id, SVC_T1_A, key);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().selection_id).toBe(first.json().selection_id);
    expect(repo.store.tenant(T1).selections).toHaveLength(1);
  });

  it('a service outside the query results cannot be selected', async () => {
    const q = (await runQuery()).json();
    const res = await select(q.query.query_id, SVC_T1_B);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(repo.store.tenant(T1).selections).toHaveLength(0);
  });

  it('only the citizen who ran the query may select (officer and other citizen refused)', async () => {
    const q = (await runQuery()).json();
    state.ctx = ctxFor(T1, CITIZEN_2, 'CITIZEN');
    const other = await select(q.query.query_id, SVC_T1_A);
    expect(other.statusCode).toBe(404);
    state.ctx = ctxFor(T1, OFFICER_1, 'OFFICER');
    const officer = await select(q.query.query_id, SVC_T1_A);
    expect(officer.statusCode).toBe(403);
    expect(repo.store.tenant(T1).selections).toHaveLength(0);
  });

  it('unpublished (DRAFT) catalogue pin is refused before any persistence', async () => {
    const res = await runQuery(queryBody({ catalogue_version_id: CAT_T1_DRAFT }));
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(Object.keys(repo.store.tenant(T1).queries)).toHaveLength(0);
  });

  it('tenant-negative: T2 cannot use T1 catalogue pin nor read T1 query; T2 sees only T2 data', async () => {
    const q = (await runQuery()).json();
    state.ctx = ctxFor(T2, CITIZEN_1, 'CITIZEN');

    const pin = await runQuery(queryBody({ catalogue_version_id: CAT_T1 }));
    expect(pin.statusCode).toBeGreaterThanOrEqual(400);
    expect(pin.body).not.toContain(SVC_T1_A);

    const read = await host().inject({
      method: 'GET',
      url: `/v1/discovery/queries/${q.query.query_id}`,
    });
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain(SVC_T1_A);

    const own = await runQuery(queryBody({ catalogue_version_id: CAT_T2 }));
    expect(own.statusCode).toBe(200);
    const ids = own.json().results.map((r: { service_id: string }) => r.service_id);
    expect(ids).toEqual([SVC_T2_A]);
    for (const row of repo.store.tenant(T2).outbox) expect(row.envelope.tenant_id).toBe(T2);
  });

  it('a leaked foreign-tenant search hit is blocked (SF-TEN-002) and nothing is persisted', async () => {
    search.leak = [{ tenant_id: T2, service_id: SVC_T2_A }];
    const res = await runQuery();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(res.body).not.toContain(SVC_T2_A);
    expect(Object.keys(repo.store.tenant(T1).queries)).toHaveLength(0);
    expect(repo.store.tenant(T1).selections).toHaveLength(0);
  });

  it('PDP unavailable fails closed (no results, no selection)', async () => {
    authorizer.fail = true;
    const res = await runQuery();
    expect(res.statusCode).toBe(503);
    expect(validate('error-response', res.json()).valid).toBe(true);
    expect(Object.keys(repo.store.tenant(T1).queries)).toHaveLength(0);
  });

  it('forged tenant headers on every discovery route are denied without canary leak', async () => {
    const q = (await runQuery()).json();
    await expectForgedTenantDenied(host(), 'POST', '/v1/discovery/queries', queryBody());
    await expectForgedTenantDenied(host(), 'GET', `/v1/discovery/queries/${q.query.query_id}`);
    await expectForgedTenantDenied(
      host(),
      'POST',
      `/v1/discovery/queries/${q.query.query_id}/selections`,
      { service_id: SVC_T1_A },
    );
    expect(repo.store.tenants()).not.toContain(CANARY);
    expect(repo.store.tenant(T1).selections).toHaveLength(0);
  });
});
