import { describe, expect, it } from 'vitest';
import { PortUnboundError } from '../../src/ports/summary-port.js';
import { buildOpsDashboardApi } from '../../src/index.js';
import { ROUTE_DESCRIPTORS } from '../../src/api/handler.js';
import { VIEW_DEFINITIONS } from '../../src/domain/model.js';
import {
  ACTOR_CITIZEN,
  ctxFor,
  SLA_SAMPLE,
  ScriptedAuthorizer,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';
import { MemoryOpsRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const REFRESH_SLA = '/v1/ops/views/SLA_SUMMARY/refresh';

describe('refresh and read', () => {
  it('refreshes a view from its port, stamps server time and emits event + audit via the outbox', async () => {
    const h = makeHarness();
    const res = await h.call('POST', REFRESH_SLA, {});
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body['refresh_outcome']).toBe('SUCCESS');
    expect(body['view']).toMatchObject({
      view_code: 'SLA_SUMMARY',
      source_component: 'CMP-029',
      status: 'OK',
      stale: false,
      as_of: '2026-10-10T10:00:00.000Z',
      snapshot_version: 1,
      non_authoritative: true,
    });
    const store = h.repo.tenant(TENANT_A);
    expect(store.refreshLog).toHaveLength(1);
    const topics = store.outbox.map((o) => o.topic);
    expect(topics).toEqual(['sf.ops-dashboard.events.v1', 'sf.audit.ingest.v1']);
    expect(store.outbox[0]?.envelope.event_type).toBe('OpsViewRefreshed');
    expect(store.outbox[0]?.envelope.data).toMatchObject({
      metric_count: 3,
      non_authoritative: true,
    });

    const got = await h.call('GET', '/v1/ops/views/SLA_SUMMARY');
    expect(got.status).toBe(200);
    expect((got.body as Body)['metrics']).toHaveLength(3);
    expect(store.outbox.at(-1)?.topic).toBe('sf.audit.ingest.v1');
  });

  it('marks a view stale after its max age and reports it in the roll-up', async () => {
    const h = makeHarness();
    await h.call('POST', REFRESH_SLA, {});
    h.clock.advance(VIEW_DEFINITIONS.SLA_SUMMARY.maxAgeSeconds * 1000 + 1000);
    const got = await h.call('GET', '/v1/ops/views/SLA_SUMMARY');
    expect((got.body as Body)['stale']).toBe(true);
  });

  it('returns 404 for a view that was never refreshed and lists it UNAVAILABLE', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/ops/views/EVENT_HEALTH')).status).toBe(404);
    const list = (await h.call('GET', '/v1/ops/views')).body as Body;
    expect(list['overall_status']).toBe('UNAVAILABLE');
    expect(list['views']).toHaveLength(5);
    expect(list['views'][0]).toMatchObject({
      status: 'UNAVAILABLE',
      last_error_code: 'NEVER_REFRESHED',
    });
  });

  it('rejects an unknown view code', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/ops/views/CASE_APPROVALS')).status).toBe(400);
    expect((await h.call('POST', '/v1/ops/views/CASE_APPROVALS/refresh', {})).status).toBe(400);
  });
});

describe('source failure is visible, never fabricated', () => {
  it('keeps last-known metrics and flips to UNAVAILABLE when the port fails', async () => {
    const h = makeHarness();
    await h.call('POST', REFRESH_SLA, {});
    h.ports.SLA_SUMMARY.failWith = Object.assign(new Error('boom'), { code: 'SLA_PORT_DOWN' });
    h.clock.advance(60_000);
    const res = await h.call('POST', REFRESH_SLA, {});
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body['refresh_outcome']).toBe('SOURCE_FAILED');
    expect(body['view']).toMatchObject({
      status: 'UNAVAILABLE',
      last_error_code: 'SLA_PORT_DOWN',
      as_of: '2026-10-10T10:00:00.000Z',
      snapshot_version: 2,
    });
    expect(body['view']['metrics']).toHaveLength(3);
    expect(h.repo.tenant(TENANT_A).refreshLog.map((r) => r.outcome)).toEqual([
      'SUCCESS',
      'SOURCE_FAILED',
    ]);
  });

  it('records UNAVAILABLE with no metrics when the very first refresh fails', async () => {
    const h = makeHarness();
    h.ports.EVENT_HEALTH.failWith = new Error('no code');
    const res = await h.call('POST', '/v1/ops/views/EVENT_HEALTH/refresh', {});
    expect((res.body as Body)['view']).toMatchObject({
      status: 'UNAVAILABLE',
      as_of: null,
      stale: true,
      last_error_code: 'SOURCE_PORT_FAILED',
      metrics: [],
    });
  });

  it('reports an unbound port as UNAVAILABLE / PORT_UNBOUND', async () => {
    const repo = new MemoryOpsRepository();
    const api = buildOpsDashboardApi({
      repository: repo,
      authorizer: new ScriptedAuthorizer(),
      resolveContext: () => Promise.resolve(ctxFor(TENANT_A)),
    });
    const res = await api.handle({
      method: 'POST',
      path: '/v1/ops/views/PLATFORM_HEALTH/refresh',
      headers: { 'idempotency-key': 'unbound-key-0001' },
      body: {},
    });
    expect((res.body as Body)['view']).toMatchObject({
      status: 'UNAVAILABLE',
      last_error_code: 'PORT_UNBOUND',
    });
    expect(new PortUnboundError('SLA_SUMMARY').code).toBe('PORT_UNBOUND');
  });

  it('refuses a payload that carries individual records and stores none of it', async () => {
    const h = makeHarness();
    h.ports.QUEUE_SUMMARY.next = {
      status: 'OK',
      metrics: [
        {
          metric_code: 'QUEUE_DEPTH',
          value: 1,
          dimensions: { queue_code: '22222222-2222-4222-8222-222222222222' },
        },
      ],
    };
    const res = await h.call('POST', '/v1/ops/views/QUEUE_SUMMARY/refresh', {});
    const body = res.body as Body;
    expect(body['refresh_outcome']).toBe('PAYLOAD_INVALID');
    expect(body['view']).toMatchObject({ status: 'UNAVAILABLE', metrics: [] });
    expect(JSON.stringify(h.repo.tenant(TENANT_A))).not.toContain(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('times out a hung port without holding a transaction', async () => {
    const h = makeHarness('2026-10-10T10:00:00Z', 20);
    h.ports.INTEGRATION_HEALTH.delayMs = 200;
    const res = await h.call('POST', '/v1/ops/views/INTEGRATION_HEALTH/refresh', {});
    expect((res.body as Body)['view']).toMatchObject({
      status: 'UNAVAILABLE',
      last_error_code: 'SOURCE_TIMEOUT',
    });
  });

  it('never calls a source port inside a database transaction', async () => {
    const h = makeHarness();
    let inTx: boolean | undefined;
    h.ports.SLA_SUMMARY.onCall = (): void => {
      inTx = h.repo.inTransaction();
    };
    await h.call('POST', REFRESH_SLA, {});
    expect(inTx).toBe(false);
  });

  it('rolls the snapshot, log, event and audit back together when the commit fails', async () => {
    const h = makeHarness();
    h.repo.failNextCommit = true;
    const res = await h.call('POST', REFRESH_SLA, {});
    expect(res.status).toBe(500);
    const store = h.repo.tenant(TENANT_A);
    expect(store.snapshots.size + store.refreshLog.length + store.outbox.length).toBe(0);
  });
});

describe('OPA enforcement (PEP on every view)', () => {
  it('asks the PDP for a distinct action per view and for refresh, scoped to the caller tenant', async () => {
    const h = makeHarness();
    await h.call('GET', '/v1/ops/views');
    expect(h.authorizer.calls.map((c) => c.action)).toEqual([
      'OPS_VIEW_SLA',
      'OPS_VIEW_QUEUE',
      'OPS_VIEW_INTEGRATION',
      'OPS_VIEW_EVENTS',
      'OPS_VIEW_HEALTH',
    ]);
    await h.call('POST', REFRESH_SLA, {});
    expect(h.authorizer.calls.at(-1)?.action).toBe('OPS_REFRESH_VIEW');
    for (const c of h.authorizer.calls) {
      expect(c.resource).toMatchObject({
        resource_type: 'OpsDashboardView',
        tenant_id: TENANT_A,
        classification: 'TENANT_SCOPED',
      });
      expect(c.subject.tenant_id).toBe(TENANT_A);
    }
  });

  it('denies a protected view, audits the denial and never reaches the source port', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions.add('OPS_REFRESH_VIEW');
    const res = await h.call('POST', REFRESH_SLA, {});
    expect(res.status).toBe(403);
    expect((res.body as Body)['error_code']).toBe('SF-AUTH-002');
    expect(h.ports.SLA_SUMMARY.calls).toBe(0);
    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.envelope.data).toMatchObject({
      result: 'DENIED',
      action: 'OPS_REFRESH_VIEW',
    });
    expect(h.repo.tenant(TENANT_A).snapshots.size).toBe(0);
  });

  it('denies reading one view while another stays readable', async () => {
    const h = makeHarness();
    await h.call('POST', REFRESH_SLA, {});
    h.authorizer.deniedActions.add('OPS_VIEW_SLA');
    expect((await h.call('GET', '/v1/ops/views/SLA_SUMMARY')).status).toBe(403);
    h.authorizer.deniedActions.clear();
    expect((await h.call('GET', '/v1/ops/views/SLA_SUMMARY')).status).toBe(200);
  });

  it('lists only the views the PDP allows and denies when none are allowed', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions = new Set([
      'OPS_VIEW_SLA',
      'OPS_VIEW_QUEUE',
      'OPS_VIEW_INTEGRATION',
    ]);
    const list = (await h.call('GET', '/v1/ops/views')).body as Body;
    expect(list['views'].map((v: Body) => v['view_code'])).toEqual([
      'EVENT_HEALTH',
      'PLATFORM_HEALTH',
    ]);
    h.authorizer.denyAll = true;
    expect((await h.call('GET', '/v1/ops/views')).status).toBe(403);
  });

  it('fails closed (503) when the PDP is unavailable, on read, list and refresh', async () => {
    const h = makeHarness();
    h.authorizer.fail = true;
    for (const [m, p] of [
      ['GET', '/v1/ops/views'],
      ['GET', '/v1/ops/views/SLA_SUMMARY'],
      ['POST', REFRESH_SLA],
    ] as const) {
      const res = await h.call(m, p, m === 'POST' ? {} : undefined);
      expect(res.status, `${m} ${p}`).toBe(503);
    }
    expect(h.ports.SLA_SUMMARY.calls).toBe(0);
    expect(h.repo.tenant(TENANT_A).outbox).toHaveLength(0);
  });

  it('keeps citizens out without consulting a policy', async () => {
    const h = makeHarness();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    for (const [m, p] of [
      ['GET', '/v1/ops/views'],
      ['GET', '/v1/ops/views/SLA_SUMMARY'],
      ['POST', REFRESH_SLA],
    ] as const) {
      expect((await h.call(m, p, m === 'POST' ? {} : undefined)).status).toBe(403);
    }
    expect(h.authorizer.calls).toHaveLength(0);
    expect(h.ports.SLA_SUMMARY.calls).toBe(0);
  });

  it('requires an authenticated tenant context', async () => {
    const h = makeHarness();
    h.state.ctx = null;
    expect((await h.call('GET', '/v1/ops/views')).status).toBe(401);
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    expect((await h.call('GET', '/v1/ops/views')).status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it('serves each tenant only its own snapshots and passes the caller context to the port', async () => {
    const h = makeHarness();
    await h.call('POST', REFRESH_SLA, {});
    h.state.ctx = ctxFor(TENANT_B);
    expect((await h.call('GET', '/v1/ops/views/SLA_SUMMARY')).status).toBe(404);
    h.ports.SLA_SUMMARY.next = {
      status: 'DEGRADED',
      metrics: [{ metric_code: 'SLA_CLOCKS', value: 99 }],
    };
    await h.call('POST', REFRESH_SLA, {});
    const b = (await h.call('GET', '/v1/ops/views/SLA_SUMMARY')).body as Body;
    expect(b['metrics'][0].value).toBe(99);
    h.state.ctx = ctxFor(TENANT_A);
    const a = (await h.call('GET', '/v1/ops/views/SLA_SUMMARY')).body as Body;
    expect(a['metrics']).toHaveLength(3);
    expect(h.ports.SLA_SUMMARY.contexts.map((c) => c.tenant_id)).toEqual([TENANT_A, TENANT_B]);
  });

  it('refuses tenant-identifying headers and client time', async () => {
    const h = makeHarness();
    for (const headers of [
      { 'x-tenant-id': TENANT_B },
      { 'X-SF-Tenant': TENANT_B },
      { forwarded: `for=1.1.1.1;tenant=${TENANT_B}` },
    ]) {
      const res = await h.call('GET', '/v1/ops/views', undefined, { headers });
      expect(res.status).toBe(403);
      expect((res.body as Body)['error_code']).toBe('SF-TEN-002');
    }
    expect(
      (
        await h.call('GET', '/v1/ops/views', undefined, {
          query: { as_of: '2020-01-01T00:00:00Z' },
        })
      ).status,
    ).toBe(400);
    expect((await h.call('POST', REFRESH_SLA, { as_of: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await h.call('POST', REFRESH_SLA, { status: 'OK' })).status).toBe(400);
  });
});

describe('idempotency', () => {
  it('replays a completed refresh without a second version or event', async () => {
    const h = makeHarness();
    const first = await h.call('POST', REFRESH_SLA, {}, { key: 'same-key-000001' });
    h.clock.advance(1000);
    const replay = await h.call('POST', REFRESH_SLA, {}, { key: 'same-key-000001' });
    expect(replay.body).toEqual(first.body);
    const store = h.repo.tenant(TENANT_A);
    expect(store.snapshots.get('SLA_SUMMARY')?.snapshot_version).toBe(1);
    expect(store.outbox.filter((o) => o.topic === 'sf.ops-dashboard.events.v1')).toHaveLength(1);
  });

  it('conflicts when one key is reused for a different view, and requires a key', async () => {
    const h = makeHarness();
    await h.call('POST', REFRESH_SLA, {}, { key: 'same-key-000002' });
    const clash = await h.call(
      'POST',
      '/v1/ops/views/EVENT_HEALTH/refresh',
      {},
      { key: 'same-key-000002' },
    );
    expect(clash.status).toBe(409);
    expect((await h.call('POST', REFRESH_SLA, {}, { key: null })).status).toBe(400);
    expect((await h.call('POST', REFRESH_SLA, {}, { key: 'short' })).status).toBe(400);
  });
});

describe('ops surface only: no authoritative case / SLA actions', () => {
  it('exposes read routes plus exactly one derived-snapshot refresh', () => {
    expect(ROUTE_DESCRIPTORS.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /v1/ops/views',
      'GET /v1/ops/views/:view_code',
      'POST /v1/ops/views/:view_code/refresh',
    ]);
    for (const r of ROUTE_DESCRIPTORS) {
      expect(r.operationId + r.path).not.toMatch(
        /approve|reject|assign|decision|pause|resume|complete|escalate|case|task/i,
      );
    }
  });

  it('refuses unsupported methods and unknown routes', async () => {
    const h = makeHarness();
    expect((await h.call('DELETE', '/v1/ops/views/SLA_SUMMARY')).status).toBe(400);
    expect((await h.call('POST', '/v1/ops/cases/approve', {})).status).toBe(404);
    expect((await h.call('PUT', '/v1/ops/views', {})).status).toBe(400);
  });

  it('keeps SLA samples as aggregates (fixture sanity)', () => {
    expect(SLA_SAMPLE.metrics.every((m) => Object.keys(m).length <= 3)).toBe(true);
  });
});
