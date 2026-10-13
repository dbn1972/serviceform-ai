import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import {
  buildOpsDashboardService,
  type SummaryPort,
} from '../../../services/cmp-046-operational-dashboard/src/index.js';
import {
  SearchIndexConsumer,
  SimulatedProjectionRules,
  type ProjectionRule,
} from '../../../services/cmp-035-search-indexing/src/index.js';
import { UnboundReplayPort } from '../../../services/cmp-045-analytics-mis/src/ports/replay-port.js';
import {
  CANARY,
  CITIZEN_1,
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
import { InMemoryOpsRepository, InMemorySearchStore } from './support/ops-search-doubles.js';

/**
 * INT-010 events → index → analytics → dashboards, at the seams M08 owns:
 *   CMP-046 (real service behind the API host) emits OpsViewRefreshed;
 *   that envelope is delivered to the real CMP-035 indexer under a SIMULATED projection rule.
 * OpenSearch, CMP-038 replay history and the owner summary adapters are not available here and
 * are recorded as boundaries, not exercised.
 */
const OPS_TOPIC = 'sf.ops-dashboard.events.v1';
const INDEXER_ACTOR = '44444444-4444-4444-8444-444444444444';

const OPS_RULE: ProjectionRule = {
  rule_id: 'e1111111-1111-4111-8111-111111111111',
  rule_version: 1,
  status: 'PUBLISHED',
  source_cmp_id: 'CMP-046',
  topic: OPS_TOPIC,
  aggregate_type: 'OpsViewSnapshot',
  upsert_event_types: ['OpsViewRefreshed'],
  remove_event_types: [],
  facets: [
    { name: 'view_code', path: 'view_code', required: true },
    { name: 'status', path: 'status', required: true },
  ],
};

class TenantAwareSlaPort implements SummaryPort {
  calls: string[] = [];
  async fetchSummary(ctx: { tenant_id: string }) {
    this.calls.push(ctx.tenant_id);
    return {
      status: 'OK' as const,
      metrics: [{ metric_code: 'OPEN_ITEMS', value: ctx.tenant_id === T1 ? 3 : 7 }],
    };
  }
}

let app: FastifyInstance | undefined;
let repo: InMemoryOpsRepository;
let state: ContextState;
let authorizer: RecordingAuthorizer;
let slaPort: TenantAwareSlaPort;
let keySeq = 0;

function host(): FastifyInstance {
  return must(app, 'app');
}

function refresh(
  view: string,
  key: string | null = `int-m08-ops-${String(++keySeq).padStart(6, '0')}`,
) {
  return host().inject({
    method: 'POST',
    url: `/v1/ops/views/${view}/refresh`,
    headers: key === null ? {} : { 'idempotency-key': key },
  });
}

beforeEach(async () => {
  repo = new InMemoryOpsRepository();
  state = new ContextState(ctxFor(T1, OFFICER_1, 'OFFICER'));
  authorizer = new RecordingAuthorizer();
  slaPort = new TenantAwareSlaPort();
  const service = buildOpsDashboardService({
    repository: repo,
    authorizer,
    ports: { SLA_SUMMARY: slaPort },
    clock: () => new Date('2026-10-13T10:00:00Z'),
  });
  app = await buildApp(config, {
    logger: silentLogger(),
    m08: { ops: { service, resolveContext: state.resolve } },
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('INT-010 CMP-046 dashboards via API host (non-authoritative, tenant-scoped)', () => {
  it('bound SLA port refresh → OK snapshot, served with non_authoritative marker', async () => {
    expect(host().m08Mounted).toEqual(['CMP-046']);
    const r = await refresh('SLA_SUMMARY');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ refresh_outcome: 'SUCCESS', view: { status: 'OK' } });
    expect(slaPort.calls).toEqual([T1]);

    const v = await host().inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' });
    expect(v.statusCode).toBe(200);
    expect(v.json()).toMatchObject({
      view_code: 'SLA_SUMMARY',
      non_authoritative: true,
      metrics: [{ metric_code: 'OPEN_ITEMS', value: 3 }],
    });
  });

  it('unbound owner port is reported UNAVAILABLE (PORT_UNBOUND), never fabricated healthy', async () => {
    const r = await refresh('QUEUE_SUMMARY');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      refresh_outcome: 'SOURCE_FAILED',
      view: { status: 'UNAVAILABLE', last_error_code: 'PORT_UNBOUND', metrics: [] },
    });
    const list = await host().inject({ method: 'GET', url: '/v1/ops/views' });
    expect(list.statusCode).toBe(200);
    expect(list.json().overall_status).toBe('UNAVAILABLE');
  });

  it('refresh emits contract-valid OpsViewRefreshed + audit envelopes scoped to the tenant', async () => {
    await refresh('SLA_SUMMARY');
    const out = repo.store.tenant(T1).outbox;
    expect(out.map((o) => o.envelope.event_type)).toContain('OpsViewRefreshed');
    for (const o of out) {
      expect(validate('event-envelope', o.envelope).valid, o.envelope.event_type).toBe(true);
      expect(o.envelope.tenant_id).toBe(T1);
    }
    const audit = out.find((o) => o.topic === 'sf.audit.ingest.v1');
    expect(validate('audit-event', must(audit).envelope.data).valid).toBe(true);
  });

  it('refresh requires Idempotency-Key and replays the same response', async () => {
    const missing = await refresh('SLA_SUMMARY', null);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error_code: 'SF-SYS-003' });
    const a = await refresh('SLA_SUMMARY', 'int-m08-ops-fixed-key');
    const b = await refresh('SLA_SUMMARY', 'int-m08-ops-fixed-key');
    expect(b.json()).toEqual(a.json());
    expect(repo.store.tenant(T1).refreshLog).toHaveLength(1);
  });

  it('tenant-negative: T2 never sees T1 snapshot; ports are called with T2 server context', async () => {
    await refresh('SLA_SUMMARY');
    state.ctx = ctxFor(T2, OFFICER_1, 'OFFICER');
    const v = await host().inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' });
    expect(v.statusCode).toBe(404);
    await refresh('SLA_SUMMARY');
    const own = await host().inject({ method: 'GET', url: '/v1/ops/views/SLA_SUMMARY' });
    expect(own.json().metrics).toEqual([{ metric_code: 'OPEN_ITEMS', value: 7 }]);
    expect(slaPort.calls).toEqual([T1, T2]);
    for (const o of repo.store.tenant(T2).outbox) expect(o.envelope.tenant_id).toBe(T2);
    expect(repo.store.tenant(T1).snapshots[0]?.metrics).toEqual([
      { metric_code: 'OPEN_ITEMS', value: 3 },
    ]);
  });

  it('citizen actors are refused on staff dashboards; PDP outage fails closed', async () => {
    state.ctx = ctxFor(T1, CITIZEN_1, 'CITIZEN');
    const c = await host().inject({ method: 'GET', url: '/v1/ops/views' });
    expect(c.statusCode).toBe(403);
    state.ctx = ctxFor(T1, OFFICER_1, 'OFFICER');
    authorizer.fail = true;
    const down = await refresh('SLA_SUMMARY');
    expect(down.statusCode).toBe(503);
    expect(repo.store.tenant(T1).snapshots).toHaveLength(0);
  });

  it('forged tenant headers on every ops route are denied without canary leak', async () => {
    await expectForgedTenantDenied(host(), 'GET', '/v1/ops/views');
    await expectForgedTenantDenied(host(), 'GET', '/v1/ops/views/SLA_SUMMARY');
    await expectForgedTenantDenied(host(), 'POST', '/v1/ops/views/SLA_SUMMARY/refresh');
    expect(repo.store.tenants()).not.toContain(CANARY);
    expect(slaPort.calls).toEqual([]);
  });
});

describe('INT-010 CMP-046 event → CMP-035 index (SIMULATED projection rule, CI)', () => {
  async function opsEvents(tenant: string) {
    state.ctx = ctxFor(tenant, OFFICER_1, 'OFFICER');
    await refresh('SLA_SUMMARY');
    const events = repo.store.tenant(tenant).outbox.filter((o) => o.topic === OPS_TOPIC);
    return must(events[0], 'OpsViewRefreshed').envelope;
  }

  function indexer(store: InMemorySearchStore) {
    return new SearchIndexConsumer({
      store,
      rules: new SimulatedProjectionRules([OPS_RULE]),
      indexerActorId: INDEXER_ACTOR,
      config: { environment: 'CI' },
      clock: () => new Date('2026-10-13T10:00:01Z'),
    });
  }

  it('indexes only declared facets under the event tenant; duplicate delivery is a no-op', async () => {
    const envelope = await opsEvents(T1);
    const store = new InMemorySearchStore();
    const consumer = indexer(store);
    const first = await consumer.ingest({ topic: OPS_TOPIC, envelope });
    expect(first.outcome).toBe('INDEXED');
    const dup = await consumer.ingest({ topic: OPS_TOPIC, envelope });
    expect(dup.outcome).toBe('DUPLICATE');

    const docs = store.tenant(T1).docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      tenant_id: T1,
      source_cmp_id: 'CMP-046',
      facets: { view_code: 'SLA_SUMMARY', status: 'OK' },
    });
    expect(Object.keys(docs[0]?.facets ?? {}).sort()).toEqual(['status', 'view_code']);
    expect(store.sessions.every((s) => s.tenantId === T1 && s.actorType === 'SYSTEM')).toBe(true);
    for (const o of store.tenant(T1).outbox) {
      expect(validate('event-envelope', o.envelope).valid, o.envelope.event_type).toBe(true);
      expect(o.envelope.tenant_id).toBe(T1);
    }
  });

  it('tenant partitions stay disjoint across T1/T2 ops events (CROSS_TENANT_LEAKAGE=0)', async () => {
    const e1 = await opsEvents(T1);
    const e2 = await opsEvents(T2);
    const store = new InMemorySearchStore();
    const consumer = indexer(store);
    await consumer.ingest({ topic: OPS_TOPIC, envelope: e1 });
    await consumer.ingest({ topic: OPS_TOPIC, envelope: e2 });
    expect(store.tenant(T1).docs.map((d) => d.tenant_id)).toEqual([T1]);
    expect(store.tenant(T2).docs.map((d) => d.tenant_id)).toEqual([T2]);
    const d1 = must(store.tenant(T1).docs[0]).document_id;
    const d2 = must(store.tenant(T2).docs[0]).document_id;
    expect(d1).not.toBe(d2);
    expect(store.tenants().sort()).toEqual([T1, T2].sort());
  });

  it('events with no published rule are skipped, not guessed', async () => {
    const envelope = await opsEvents(T1);
    const store = new InMemorySearchStore();
    const consumer = new SearchIndexConsumer({
      store,
      rules: new SimulatedProjectionRules([]),
      indexerActorId: INDEXER_ACTOR,
      config: { environment: 'CI' },
    });
    const out = await consumer.ingest({ topic: OPS_TOPIC, envelope });
    expect(out).toEqual({ outcome: 'SKIPPED', reason: 'NO_PROJECTION_RULE' });
    expect(store.tenants()).toEqual([]);
  });
});

describe('INT-010 CMP-045 analytics rebuild boundary', () => {
  it('unbound replay source fails explicitly (SF-INT-001 REPLAY_SOURCE_UNBOUND)', async () => {
    await expect(new UnboundReplayPort().readBatch()).rejects.toMatchObject({
      code: 'SF-INT-001',
      details: [{ code: 'REPLAY_SOURCE_UNBOUND' }],
    });
  });
});
