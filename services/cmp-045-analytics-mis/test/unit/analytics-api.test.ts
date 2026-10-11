import { describe, expect, it } from 'vitest';
import type { Cmp045Error } from '../../src/errors.js';
import {
  COUNT_DEFINITION,
  ctxFor,
  eventFor,
  PURPOSE,
  SUM_DEFINITION,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROUTE = '/v1/analytics/metric-definitions';
const METRICS = '/v1/analytics/metrics';

async function ingestMany(h: Harness, tenant: string, n: number, data: Record<string, unknown>) {
  for (let i = 0; i < n; i += 1) await h.service.ingest(h.submitted(tenant, data));
}

function query(h: Harness, q: Record<string, string>) {
  return h.call('GET', METRICS, undefined, { query: { purpose_code: PURPOSE, ...q } });
}

describe('request boundary: tenant, identity and idempotency are server-derived', () => {
  it('refuses tenant-identifying headers and a missing context', async () => {
    const h = makeHarness();
    for (const headers of [
      { 'x-tenant-id': TENANT_B },
      { 'X-SF-Anything': '1' },
      { 'x-roles': 'ADMIN' },
      { forwarded: `for=1.2.3.4;tenant=${TENANT_B}` },
    ]) {
      const res = await h.call('GET', ROUTE, undefined, { headers });
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect((res.body as Body).error_code).toBe('SF-TEN-002');
    }
    h.state.ctx = null;
    expect((await h.call('GET', ROUTE)).status).toBe(401);
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    expect(((await h.call('GET', ROUTE)).body as Body).error_code).toBe('SF-TEN-001');
  });

  it('requires an idempotency key on mutations and replays an identical retry', async () => {
    const h = makeHarness();
    const none = await h.call('POST', ROUTE, COUNT_DEFINITION, { key: null });
    expect(none.status).toBe(400);
    const first = await h.call('POST', ROUTE, COUNT_DEFINITION, { key: 'idem-key-0001' });
    const again = await h.call('POST', ROUTE, COUNT_DEFINITION, { key: 'idem-key-0001' });
    expect(first.status).toBe(201);
    expect(again).toMatchObject({ status: 201, body: first.body });
    expect(h.repo.tenant(TENANT_A).definitions.size).toBe(1);
    const conflict = await h.call(
      'POST',
      ROUTE,
      { ...COUNT_DEFINITION, publication_ref: 'pub:other' },
      { key: 'idem-key-0001' },
    );
    expect(conflict.status).toBe(409);
    expect((conflict.body as Body).error_code).toBe('SF-APP-002');
  });

  it('unknown routes are 404 and wrong methods are 400; GET bodies are refused', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/v1/analytics/nope')).status).toBe(404);
    expect((await h.call('PUT', ROUTE, {})).status).toBe(400);
    expect((await h.call('GET', ROUTE, { x: 1 })).status).toBe(400);
  });
});

describe('metric definitions: published, versioned, immutable', () => {
  it('publishes version 1 then 2 of the same code, emits events and audits', async () => {
    const h = makeHarness();
    const v1 = await h.publish();
    const v2 = await h.publish();
    expect(v1).not.toBe(v2);
    const list = await h.call('GET', ROUTE, undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED' },
    });
    expect((list.body as Body).definitions.map((d: Body) => d.version_no)).toEqual([1, 2]);
    const outbox = h.repo.tenant(TENANT_A).outbox;
    expect(
      outbox.filter((o) => o.envelope.event_type === 'AnalyticsMetricDefinitionPublished'),
    ).toHaveLength(2);
    expect(outbox.filter((o) => o.topic === 'sf.audit.ingest.v1')).toHaveLength(2);
    const get = await h.call('GET', `${ROUTE}/${v1}`);
    expect((get.body as Body).definition.status).toBe('PUBLISHED');
  });

  it('retires once; a second retire is an invalid transition; unknown id is 404', async () => {
    const h = makeHarness();
    const id = await h.publish();
    const retired = await h.call('POST', `${ROUTE}/${id}/retire`, {});
    expect((retired.body as Body).definition.status).toBe('RETIRED');
    expect((await h.call('POST', `${ROUTE}/${id}/retire`, {})).status).toBe(409);
    expect(
      (await h.call('POST', `${ROUTE}/${'0'.repeat(8)}-0000-4000-8000-000000000000/retire`, {}))
        .status,
    ).toBe(404);
    expect((await h.call('GET', `${ROUTE}/not-a-uuid`)).status).toBe(400);
  });

  it('refuses unknown members (tenant, time, actor) and identifying or malformed definitions', async () => {
    const h = makeHarness();
    const refusals: [string, object][] = [
      ['UNKNOWN_PROPERTY', { ...COUNT_DEFINITION, tenant_id: TENANT_B }],
      ['UNKNOWN_PROPERTY', { ...COUNT_DEFINITION, occurred_at: '2026-10-05T00:00:00Z' }],
      [
        'IDENTIFYING_FIELD_REFUSED',
        {
          ...COUNT_DEFINITION,
          dimensions: [{ key: 'service_code', source_field: 'applicant_name' }],
        },
      ],
      [
        'IDENTIFYING_FIELD_REFUSED',
        {
          ...COUNT_DEFINITION,
          dimensions: [{ key: 'application_id', source_field: 'service_code' }],
        },
      ],
      ['IDENTIFYING_FIELD_REFUSED', { ...SUM_DEFINITION, value_field: 'account_balance' }],
      [
        'DUPLICATE_DIMENSION_KEY',
        {
          ...COUNT_DEFINITION,
          dimensions: [
            { key: 'a_b', source_field: 'x_y' },
            { key: 'a_b', source_field: 'z_y' },
          ],
        },
      ],
      [
        'CATEGORY_CODES_REQUIRED',
        {
          ...COUNT_DEFINITION,
          dimensions: [{ key: 'channel', source_field: 'channel', allowed_values: ['web'] }],
        },
      ],
      [
        'CATEGORY_CODES_REQUIRED',
        {
          ...COUNT_DEFINITION,
          dimensions: [{ key: 'channel', source_field: 'channel', allowed_values: ['A@B.COM'] }],
        },
      ],
      ['VALUE_FIELD_REQUIRED', { ...COUNT_DEFINITION, aggregation: 'SUM' }],
      ['VALUE_FIELD_NOT_ALLOWED', { ...COUNT_DEFINITION, value_field: 'fee_amount' }],
      ['ENUM', { ...COUNT_DEFINITION, aggregation: 'AVG' }],
      ['ENUM', { ...COUNT_DEFINITION, period_granularity: 'YEAR' }],
      ['INTEGER_RANGE', { ...COUNT_DEFINITION, min_cohort_size: 0 }],
      ['CODE_PATTERN', { ...COUNT_DEFINITION, purpose_code: 'lower' }],
      [
        'LIST_INVALID',
        {
          ...COUNT_DEFINITION,
          dimensions: Array.from({ length: 7 }, (_, i) => ({
            key: `dim_${i}x`,
            source_field: `fld_${i}x`,
          })),
        },
      ],
    ];
    for (const [code, body] of refusals) {
      const res = await h.call('POST', ROUTE, body);
      expect(res.status, code).toBe(400);
      expect(JSON.stringify((res.body as Body).details), code).toContain(code);
    }
    expect(h.repo.tenant(TENANT_A).definitions.size).toBe(0);
  });
});

describe('ingest: projection only, aggregates only, duplicate-safe', () => {
  it('aggregates events into one point per period and dimension set; stores no payload', async () => {
    const h = makeHarness();
    await h.publish();
    const payload = {
      service_code: 'RESIDENCE_CERT',
      channel: 'WEB',
      applicant_name: 'Ravi Kumar',
      mobile: '9876543210',
    };
    await ingestMany(h, TENANT_A, 4, payload);
    await h.service.ingest(h.submitted(TENANT_A, { ...payload, channel: 'MOBILE' }));
    const points = [...h.repo.tenant(TENANT_A).points.values()];
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.value).sort()).toEqual([1, 4]);
    const stored = JSON.stringify([points, [...h.repo.tenant(TENANT_A).applied]]);
    expect(stored).not.toContain('Ravi');
    expect(stored).not.toContain('9876543210');
    expect(stored).not.toContain('applicant');
  });

  it('duplicate delivery of the same event never double counts', async () => {
    const h = makeHarness();
    await h.publish();
    const event = h.submitted(TENANT_A, { service_code: 'S1', channel: 'WEB' });
    const first = await h.service.ingest(event);
    const second = await h.service.ingest(event);
    expect(first).toMatchObject({
      duplicate_delivery: false,
      matched_definitions: 1,
      contributions_applied: 1,
    });
    expect(second.duplicate_delivery).toBe(true);
    expect([...h.repo.tenant(TENANT_A).points.values()][0]?.value).toBe(1);
  });

  it('SUM aggregates the declared field; COUNT and SUM definitions can share a tenant', async () => {
    const h = makeHarness();
    await h.publish();
    await h.publish(SUM_DEFINITION);
    for (const amount of [100, 25.5]) {
      await h.service.ingest(
        eventFor(
          TENANT_A,
          { service_code: 'S1', fee_amount: amount },
          {
            event_type: 'FeeAssessed',
            aggregate_type: 'Fee',
            occurred_at: '2026-10-05T01:00:00.000Z',
          },
        ),
      );
    }
    const sums = [...h.repo.tenant(TENANT_A).points.values()].filter(
      (p) => p.metric_code === 'FEES_ASSESSED',
    );
    expect(sums).toHaveLength(1);
    expect(sums[0]?.value).toBe(125.5);
    expect(sums[0]?.period_start).toBe('2026-10-01T00:00:00.000Z');
  });

  it('records unclassified values as UNCLASSIFIED, never the raw value', async () => {
    const h = makeHarness();
    await h.publish();
    const r = await h.service.ingest(
      h.submitted(TENANT_A, { service_code: 'x.y@example.org', channel: 'KIOSK' }),
    );
    expect(r.unclassified_dimensions).toBe(2);
    const dims = [...h.repo.tenant(TENANT_A).points.values()][0]?.dimensions;
    expect(dims).toEqual({ channel: 'UNCLASSIFIED', service_code: 'UNCLASSIFIED' });
    expect(JSON.stringify(h.repo.tenant(TENANT_A))).not.toContain('example.org');
  });

  it('an event with no matching published definition changes nothing', async () => {
    const h = makeHarness();
    const id = await h.publish();
    await h.call('POST', `${ROUTE}/${id}/retire`, {});
    const r = await h.service.ingest(h.submitted(TENANT_A, { service_code: 'S1' }));
    expect(r.matched_definitions).toBe(0);
    expect(h.repo.tenant(TENANT_A).points.size).toBe(0);
  });

  it('fails explicitly on schema-version mismatch, bad value, future event time and tenant-less events', async () => {
    const h = makeHarness();
    await h.publish();
    await h.publish(SUM_DEFINITION);
    const expectCode = async (p: Promise<unknown>, code: string, detail?: string) => {
      try {
        await p;
        expect.unreachable();
      } catch (e) {
        expect((e as Cmp045Error).code).toBe(code);
        if (detail) expect(JSON.stringify((e as Cmp045Error).details)).toContain(detail);
      }
    };
    await expectCode(
      h.service.ingest(eventFor(TENANT_A, {}, { schema_version: 2 })),
      'SF-SYS-003',
      'SCHEMA_VERSION_UNSUPPORTED',
    );
    await expectCode(
      h.service.ingest(
        eventFor(
          TENANT_A,
          { fee_amount: 'abc' },
          { event_type: 'FeeAssessed', aggregate_type: 'Fee' },
        ),
      ),
      'SF-SYS-003',
      'VALUE_FIELD_INVALID',
    );
    await expectCode(
      h.service.ingest(eventFor(TENANT_A, {}, { occurred_at: '2026-10-06T11:00:00.000Z' })),
      'SF-SYS-003',
      'EVENT_TIME_IN_FUTURE',
    );
    await expectCode(
      h.service.ingest({ ...eventFor(TENANT_A, {}), tenant_id: null }),
      'SF-TEN-001',
    );
    expect(h.repo.tenant(TENANT_A).points.size).toBe(0);
    expect(h.repo.tenant(TENANT_A).inbox.size).toBe(0);
  });

  it('a failed commit leaves no partial aggregate and the redelivery applies once', async () => {
    const h = makeHarness();
    await h.publish();
    const event = h.submitted(TENANT_A, { service_code: 'S1', channel: 'WEB' });
    h.repo.failNextCommit = true;
    await expect(h.service.ingest(event)).rejects.toThrow('commit failed');
    expect(h.repo.tenant(TENANT_A).points.size).toBe(0);
    await h.service.ingest(event);
    expect([...h.repo.tenant(TENANT_A).points.values()][0]?.value).toBe(1);
  });

  it('tenant comes from the validated envelope: tenant B events never touch tenant A aggregates', async () => {
    const h = makeHarness();
    await h.publish();
    await ingestMany(h, TENANT_B, 3, { service_code: 'S1', channel: 'WEB' });
    expect(h.repo.tenant(TENANT_A).points.size).toBe(0);
    expect(h.repo.tenant(TENANT_B).points.size).toBe(0);
    h.state.ctx = ctxFor(TENANT_B);
    await h.publish();
    await ingestMany(h, TENANT_B, 3, { service_code: 'S1', channel: 'WEB' });
    expect([...h.repo.tenant(TENANT_B).points.values()][0]?.value).toBe(3);
    expect(h.repo.tenant(TENANT_A).points.size).toBe(0);
  });

  it('authorizes as the consumer workload identity, outside any transaction, and fails closed', async () => {
    const h = makeHarness();
    await h.publish();
    await h.service.ingest(h.submitted(TENANT_A, { service_code: 'S1' }));
    const call = h.authorizer.calls.at(-1);
    expect(call?.action).toBe('ANALYTICS_EVENT_INGEST');
    expect(call?.subject).toMatchObject({ actor_type: 'SYSTEM', tenant_id: TENANT_A });
    h.authorizer.deny = true;
    await expect(
      h.service.ingest(h.submitted(TENANT_A, { service_code: 'S2' })),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    h.authorizer.deny = false;
    h.authorizer.fail = true;
    await expect(
      h.service.ingest(h.submitted(TENANT_A, { service_code: 'S3' })),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
    expect(h.repo.tenant(TENANT_A).inbox.size).toBe(1);
  });
});

describe('query: purpose limitation, small-cohort suppression, tenant isolation', () => {
  it('returns contract-shaped aggregates and suppresses cells below the cohort minimum', async () => {
    const h = makeHarness();
    await h.publish();
    await ingestMany(h, TENANT_A, 3, { service_code: 'BIG', channel: 'WEB' });
    await ingestMany(h, TENANT_A, 2, { service_code: 'SMALL', channel: 'WEB' });
    const res = await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' });
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics[0].metric).toMatchObject({
      contract_id: 'SF-CON-ANALYTICS-METRIC',
      value: 3,
      dimensions: { service_code: 'BIG', channel: 'WEB' },
      aggregate_only: true,
      raw_pii_payload_forbidden: true,
      purpose_code: PURPOSE,
    });
    expect(body.suppressed_count).toBe(1);
    expect(JSON.stringify(body)).not.toContain('SMALL');
  });

  it('filters by period window and dimension equality', async () => {
    const h = makeHarness();
    await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
    await h.service.ingest(
      h.submitted(TENANT_A, { service_code: 'S1', channel: 'WEB' }, '2026-10-04T10:00:00.000Z'),
    );
    await h.service.ingest(
      h.submitted(TENANT_A, { service_code: 'S1', channel: 'MOBILE' }, '2026-10-05T10:00:00.000Z'),
    );
    const day5 = await query(h, {
      metric_code: 'APPLICATIONS_SUBMITTED',
      period_from: '2026-10-05T00:00:00Z',
      period_to: '2026-10-06T00:00:00Z',
    });
    expect((day5.body as Body).metrics).toHaveLength(1);
    const web = await query(h, { metric_code: 'APPLICATIONS_SUBMITTED', 'dim.channel': 'WEB' });
    expect((web.body as Body).metrics.map((m: Body) => m.metric.dimensions.channel)).toEqual([
      'WEB',
    ]);
  });

  it('refuses a purpose the definition does not declare, and audits the denial', async () => {
    const h = makeHarness();
    await h.publish();
    await ingestMany(h, TENANT_A, 3, { service_code: 'S1', channel: 'WEB' });
    const wrong = await h.call('GET', METRICS, undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: 'MARKETING' },
    });
    expect(wrong.status).toBe(403);
    expect(JSON.stringify((wrong.body as Body).details)).toContain('PURPOSE_NOT_PERMITTED');
    const missing = await h.call('GET', METRICS, undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED' },
    });
    expect(missing.status).toBe(400);
    const audits = h.repo
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === 'sf.audit.ingest.v1')
      .map((o) => o.envelope.data as Body);
    expect(audits.some((a) => a.action === 'ANALYTICS_METRIC_READ' && a.result === 'DENIED')).toBe(
      true,
    );
  });

  it('a server-derived context purpose wins over, and cannot be widened by, the query parameter', async () => {
    const h = makeHarness();
    await h.publish();
    await ingestMany(h, TENANT_A, 3, { service_code: 'S1', channel: 'WEB' });
    h.state.ctx = { ...ctxFor(TENANT_A), purpose: PURPOSE };
    expect(
      (
        await h.call('GET', METRICS, undefined, {
          query: { metric_code: 'APPLICATIONS_SUBMITTED' },
        })
      ).status,
    ).toBe(200);
    h.state.ctx = { ...ctxFor(TENANT_A), purpose: 'OTHER_PURPOSE' };
    const widened = await h.call('GET', METRICS, undefined, {
      query: { metric_code: 'APPLICATIONS_SUBMITTED', purpose_code: PURPOSE },
    });
    expect(widened.status).toBe(403);
  });

  it('tenant B cannot read tenant A metrics or definitions (CROSS_TENANT_LEAKAGE=0)', async () => {
    const h = makeHarness();
    const idA = await h.publish();
    await ingestMany(h, TENANT_A, 3, { service_code: 'CANARY_A', channel: 'WEB' });
    h.state.ctx = ctxFor(TENANT_B);
    expect((await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' })).status).toBe(404);
    expect((await h.call('GET', `${ROUTE}/${idA}`)).status).toBe(404);
    expect(((await h.call('GET', ROUTE)).body as Body).definitions).toEqual([]);
    expect((await h.call('POST', `${ROUTE}/${idA}/retire`, {})).status).toBe(404);
    expect((await h.call('POST', `${ROUTE}/${idA}/rebuild`, {})).status).toBe(404);
    h.state.ctx = ctxFor(TENANT_A);
    expect(
      ((await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' })).body as Body).metrics,
    ).toHaveLength(1);
  });

  it('OPA deny and PDP outage fail closed before any data is read', async () => {
    const h = makeHarness();
    await h.publish();
    h.authorizer.deny = true;
    expect((await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' })).status).toBe(403);
    h.authorizer.deny = false;
    h.authorizer.fail = true;
    const down = await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' });
    expect(down.status).toBe(503);
  });

  it('rejects malformed query input', async () => {
    const h = makeHarness();
    await h.publish();
    for (const q of [
      { metric_code: 'lower' },
      { metric_code: 'APPLICATIONS_SUBMITTED', limit: '0' },
      { metric_code: 'APPLICATIONS_SUBMITTED', period_from: 'yesterday' },
      { metric_code: 'APPLICATIONS_SUBMITTED', 'dim.channel': 'ravi@example.org' },
      { metric_code: 'APPLICATIONS_SUBMITTED', tenant_id: TENANT_B },
    ]) {
      expect((await query(h, q)).status, JSON.stringify(q)).toBe(400);
    }
  });
});

describe('rebuild: derived store is rebuildable from events (INT-010)', () => {
  function seedHistory(h: Harness, tenant: string, n: number) {
    const events = Array.from({ length: n }, (_, i) =>
      h.submitted(
        tenant,
        { service_code: i % 2 === 0 ? 'EVEN' : 'ODD', channel: 'WEB' },
        `2026-10-0${(i % 3) + 1}T08:00:00.000Z`,
      ),
    );
    for (const e of events) h.replay.add(e);
    return events;
  }

  it('rebuilt aggregates equal the live-projected aggregates, with generations swapped atomically', async () => {
    const h = makeHarness();
    const id = await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
    const events = seedHistory(h, TENANT_A, 7);
    for (const e of events) await h.service.ingest(e);
    const live = JSON.stringify(
      [...h.repo.tenant(TENANT_A).points.values()]
        .map((p) => [p.metric_id, p.period_start, p.dimensions, p.value, p.contributor_count])
        .sort(),
    );
    const res = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      active_generation: 2,
      events_applied: 7,
      events_duplicate: 0,
    });
    const rebuilt = JSON.stringify(
      [...h.repo.tenant(TENANT_A).points.values()]
        .map((p) => [p.metric_id, p.period_start, p.dimensions, p.value, p.contributor_count])
        .sort(),
    );
    expect(rebuilt).toBe(live);
    expect([...h.repo.tenant(TENANT_A).points.values()].every((p) => p.generation === 2)).toBe(
      true,
    );
    expect(h.replay.requests.length).toBe(4);
    expect(h.replay.requests.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it('rebuilds a lost projection from history and a corrupted one back to the truth', async () => {
    const h = makeHarness();
    const id = await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
    seedHistory(h, TENANT_A, 5);
    const res = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(res.status).toBe(200);
    const total = [...h.repo.tenant(TENANT_A).points.values()].reduce((s, p) => s + p.value, 0);
    expect(total).toBe(5);
    for (const p of h.repo.tenant(TENANT_A).points.values()) p.value += 100;
    await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect([...h.repo.tenant(TENANT_A).points.values()].reduce((s, p) => s + p.value, 0)).toBe(5);
  });

  it('live events arriving mid-rebuild are applied to both generations and never lost or doubled', async () => {
    const h = makeHarness();
    const id = await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
    const history = seedHistory(h, TENANT_A, 4);
    const late = h.submitted(TENANT_A, { service_code: 'LATE', channel: 'WEB' });
    let fired = false;
    h.replay.onBatch = async () => {
      if (fired) return;
      fired = true;
      await h.service.ingest(late);
      h.replay.add(late);
    };
    const res = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(res.status).toBe(200);
    expect(history.length).toBe(4);
    const total = [...h.repo.tenant(TENANT_A).points.values()].reduce((s, p) => s + p.value, 0);
    expect(total).toBe(5);
    expect(res.body).toMatchObject({ events_applied: 4, events_duplicate: 1 });
  });

  it('refuses a concurrent rebuild while the lease is held and takes over after it expires', async () => {
    const h = makeHarness();
    const id = await h.publish();
    seedHistory(h, TENANT_A, 3);
    h.replay.failWith = new Error('source offline');
    const failed = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(failed.status).toBe(503);
    expect((failed.body as Body).error_code).toBe('SF-INT-001');
    h.replay.failWith = null;
    const blocked = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(blocked.status).toBe(409);
    expect(JSON.stringify((blocked.body as Body).details)).toContain('REBUILD_IN_PROGRESS');
    h.clock.set('2026-10-06T10:20:00Z');
    expect((await h.call('POST', `${ROUTE}/${id}/rebuild`, {})).status).toBe(200);
  });

  it('a failed or oversized rebuild never replaces the active generation', async () => {
    const h = makeHarness();
    const id = await h.publish({ ...COUNT_DEFINITION, min_cohort_size: 1 });
    await h.service.ingest(h.submitted(TENANT_A, { service_code: 'LIVE', channel: 'WEB' }));
    seedHistory(h, TENANT_A, 3);
    h.replay.failWith = new Error('source offline');
    await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    const live = [...h.repo.tenant(TENANT_A).points.values()].filter((p) => p.generation === 1);
    expect(live).toHaveLength(1);
    const state = h.repo.tenant(TENANT_A).states.get(id);
    expect(state?.active_generation).toBe(1);
    expect(state?.building_generation).toBe(2);
    const res = await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' });
    expect((res.body as Body).metrics[0].metric.dimensions.service_code).toBe('LIVE');
  });

  it('refuses events from another tenant returned by the replay source', async () => {
    const h = makeHarness();
    const id = await h.publish();
    h.replay.add(h.submitted(TENANT_B, { service_code: 'CANARY_B', channel: 'WEB' }));
    const res = await h.call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(res.status).toBe(403);
    expect((res.body as Body).error_code).toBe('SF-TEN-002');
    expect(JSON.stringify(h.repo.tenant(TENANT_A))).not.toContain('CANARY_B');
  });

  it('fails explicitly while no event history is bound, and refuses retired definitions', async () => {
    const h = makeHarness();
    const id = await h.publish();
    const unbound = (await import('../../src/index.js')).buildAnalyticsService({
      repository: h.repo,
      authorizer: h.authorizer,
      clock: h.clock.now,
      consumerActorId: ctxFor(TENANT_A).actor.id,
    });
    await expect(
      unbound.rebuild(ctxFor(TENANT_A) as never, id, {
        key: 'rebuild-unbound-1',
        endpoint: 'POST rebuild',
        fingerprint: `sha256:${'a'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'SF-INT-001' });
    expect(h.repo.tenant(TENANT_A).states.get(id)?.active_generation).toBe(1);
    const retired = await h.publish();
    await h.call('POST', `${ROUTE}/${retired}/retire`, {});
    expect((await h.call('POST', `${ROUTE}/${retired}/rebuild`, {})).status).toBe(409);
  });

  it('stops at the batch limit instead of looping unbounded', async () => {
    const h = makeHarness();
    const limited = (await import('../../src/index.js')).buildAnalyticsService({
      repository: h.repo,
      authorizer: h.authorizer,
      replay: h.replay,
      clock: h.clock.now,
      consumerActorId: ctxFor(TENANT_A).actor.id,
      rebuildBatchSize: 1,
      maxRebuildBatches: 2,
    });
    const id = await h.publish();
    seedHistory(h, TENANT_A, 5);
    await expect(
      limited.rebuild(ctxFor(TENANT_A) as never, id, {
        key: 'rebuild-limit-1',
        endpoint: 'POST rebuild',
        fingerprint: 'sha256:' + 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-004' });
  });

  it('retries with the same key replay the stored result without a second rebuild', async () => {
    const h = makeHarness();
    const id = await h.publish();
    seedHistory(h, TENANT_A, 3);
    const first = await h.call('POST', `${ROUTE}/${id}/rebuild`, {}, { key: 'rebuild-key-01' });
    const calls = h.replay.requests.length;
    const again = await h.call('POST', `${ROUTE}/${id}/rebuild`, {}, { key: 'rebuild-key-01' });
    expect(again.body).toEqual(first.body);
    expect(h.replay.requests.length).toBe(calls);
  });
});

describe('boundary behaviour', () => {
  it('network-facing work never runs inside a transaction', async () => {
    const h = makeHarness();
    await h.publish();
    const original = h.authorizer.decide.bind(h.authorizer);
    let sawTx = false;
    h.authorizer.decide = (input) => {
      sawTx ||= h.repo.inTransaction();
      return original(input);
    };
    h.replay.onBatch = async () => {
      sawTx ||= h.repo.inTransaction();
    };
    await h.service.ingest(h.submitted(TENANT_A, { service_code: 'S1' }));
    await query(h, { metric_code: 'APPLICATIONS_SUBMITTED' });
    expect(sawTx).toBe(false);
  });

  it('metric points hold no PII keys even when events carry them', async () => {
    const h = makeHarness();
    await h.publish();
    await h.service.ingest(
      h.submitted(TENANT_A, {
        service_code: 'S1',
        channel: 'WEB',
        email: 'a@b.org',
        applicant_name: 'N',
        aadhaar_no: '123412341234',
      }),
    );
    const text = JSON.stringify([...h.repo.tenant(TENANT_A).points.values()]);
    for (const needle of ['a@b.org', 'applicant', 'aadhaar', '123412341234', 'email'])
      expect(text, needle).not.toContain(needle);
  });
});
