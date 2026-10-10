import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnalyticsApi, type ApiResponse } from '../../src/api/handler.js';
import { buildAnalyticsService } from '../../src/index.js';
import { PgAnalyticsRepository } from '../../src/repo/pg.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  CONSUMER_ACTOR,
  COUNT_DEFINITION,
  ctxFor,
  eventFor,
  MutableClock,
  PURPOSE,
  SimulatedReplaySource,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, setupHarness, T1, T2, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROUTE = '/v1/analytics/metric-definitions';

describe('CMP-045 end to end on PostgreSQL (real login role, FORCE RLS)', () => {
  let h: Harness;
  let clock: MutableClock;
  let authorizer: AllowAllAuthorizer;
  let replay: SimulatedReplaySource;
  const state: { ctx: RequestContext | null } = { ctx: ctxFor(T1) };
  let api: ReturnType<typeof createAnalyticsApi>;
  let service: ReturnType<typeof buildAnalyticsService>;
  let counter = 0;

  beforeAll(async () => {
    h = await setupHarness();
    clock = new MutableClock(Date.parse('2026-10-06T10:00:00Z'));
    authorizer = new AllowAllAuthorizer();
    replay = new SimulatedReplaySource();
    service = buildAnalyticsService({
      repository: new PgAnalyticsRepository(asSqlPool(h.rt)),
      authorizer,
      replay,
      clock: clock.now,
      consumerActorId: CONSUMER_ACTOR,
      rebuildBatchSize: 3,
    });
    api = createAnalyticsApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<ApiResponse> {
    counter += 1;
    const headers: Record<string, string> = {};
    if (method !== 'GET')
      headers['idempotency-key'] = `int-key-${String(counter).padStart(8, '0')}`;
    return api.handle({ method, path, headers, ...(query ? { query } : {}), body });
  }

  const submitted = (
    tenant: string,
    data: Record<string, unknown>,
    at = '2026-10-05T09:30:00.000Z',
  ) => eventFor(tenant, data, { occurred_at: at });

  it('publishes a definition, projects events concurrently without double counting, and serves aggregates', async () => {
    state.ctx = ctxFor(T1);
    const res = await call('POST', ROUTE, { ...COUNT_DEFINITION, min_cohort_size: 3 });
    expect(res.status).toBe(201);
    const id = (res.body as Body).definition.definition_id as string;

    const events = Array.from({ length: 12 }, (_, i) =>
      submitted(T1, {
        service_code: i < 9 ? 'BIG' : 'SMALL',
        channel: 'WEB',
        applicant_name: 'CANARY-PII-NAME',
        mobile: '9876543210',
        email: 'canary@example.org',
      }),
    );
    // Concurrent workers, each event delivered twice, interleaved.
    await Promise.all([...events, ...events].map((e) => service.ingest(e)));
    const counts = await h.admin.query(
      `SELECT dimensions->>'service_code' AS service, value::int AS value, contributor_count::int AS n
         FROM sf_analytics.metric_point WHERE tenant_id = $1 ORDER BY 1`,
      [T1],
    );
    expect(counts.rows).toEqual([
      { service: 'BIG', value: 9, n: 9 },
      { service: 'SMALL', value: 3, n: 3 },
    ]);

    const q = await call('GET', '/v1/analytics/metrics', undefined, {
      metric_code: 'APPLICATIONS_SUBMITTED',
      purpose_code: PURPOSE,
    });
    expect(q.status).toBe(200);
    expect((q.body as Body).metrics.map((m: Body) => m.metric.value).sort()).toEqual([3, 9]);

    const small = submitted(T1, { service_code: 'TINY', channel: 'WEB' });
    await service.ingest(small);
    const again = await call('GET', '/v1/analytics/metrics', undefined, {
      metric_code: 'APPLICATIONS_SUBMITTED',
      purpose_code: PURPOSE,
    });
    expect((again.body as Body).suppressed_count).toBe(1);
    expect(JSON.stringify(again.body)).not.toContain('TINY');

    const text = await h.admin.query(
      `SELECT (SELECT string_agg(t::text, ' ') FROM sf_analytics.metric_point t) ||
              (SELECT string_agg(t::text, ' ') FROM sf_analytics.projection_applied_event t) ||
              (SELECT string_agg(t::text, ' ') FROM sf_analytics.outbox_event t) ||
              (SELECT string_agg(t::text, ' ') FROM sf_analytics.inbox_event t) AS dump`,
    );
    const dump = String(text.rows[0]?.['dump']);
    for (const needle of [
      'CANARY-PII-NAME',
      '9876543210',
      'canary@example.org',
      'applicant',
      'mobile',
    ]) {
      expect(dump, needle).not.toContain(needle);
    }
    expect(id).toBeTruthy();
  });

  it('the outbox carries definition events and audit; the inbox records each delivered event once', async () => {
    const outbox = await h.admin.query(
      `SELECT event_type, topic FROM sf_analytics.outbox_event WHERE tenant_id = $1 ORDER BY seq`,
      [T1],
    );
    const types = outbox.rows.map((r) => `${String(r['topic'])}:${String(r['event_type'])}`);
    expect(types).toContain('sf.analytics.events.v1:AnalyticsMetricDefinitionPublished');
    expect(types).toContain('sf.audit.ingest.v1:AuditEventSubmitted');
    const inbox = await h.admin.query(
      `SELECT count(*)::int AS n, count(DISTINCT event_id)::int AS d FROM sf_analytics.inbox_event WHERE tenant_id = $1`,
      [T1],
    );
    expect(inbox.rows[0]).toEqual({ n: 13, d: 13 });
  });

  it('tenant T2 cannot see or touch T1 data through the API (cross-tenant negative at API, repository and DB)', async () => {
    state.ctx = ctxFor(T2);
    const idT1 = String(
      (
        await h.admin.query(
          `SELECT definition_id FROM sf_analytics.metric_definition WHERE tenant_id = $1`,
          [T1],
        )
      ).rows[0]?.['definition_id'],
    );
    expect(((await call('GET', ROUTE)).body as Body).definitions).toEqual([]);
    expect((await call('GET', `${ROUTE}/${idT1}`)).status).toBe(404);
    expect((await call('POST', `${ROUTE}/${idT1}/retire`, {})).status).toBe(404);
    expect((await call('POST', `${ROUTE}/${idT1}/rebuild`, {})).status).toBe(404);
    expect(
      (
        await call('GET', '/v1/analytics/metrics', undefined, {
          metric_code: 'APPLICATIONS_SUBMITTED',
          purpose_code: PURPOSE,
        })
      ).status,
    ).toBe(404);
    await service.ingest(submitted(T2, { service_code: 'T2ONLY', channel: 'WEB' }));
    const t1 = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_analytics.metric_point WHERE tenant_id = $1 AND dimensions->>'service_code' = 'T2ONLY'`,
      [T1],
    );
    expect(t1.rows[0]?.['n']).toBe(0);
    state.ctx = ctxFor(T1);
  });

  it('rebuild reproduces the live aggregates from history and swaps generations atomically', async () => {
    state.ctx = ctxFor(T1);
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'REBUILD_CHECK',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    replay.events.length = 0;
    const history = Array.from({ length: 10 }, (_, i) =>
      submitted(
        T1,
        { service_code: i % 2 === 0 ? 'EVEN' : 'ODD', channel: i % 3 === 0 ? 'WEB' : 'MOBILE' },
        `2026-10-0${(i % 4) + 1}T08:00:00.000Z`,
      ),
    );
    for (const e of history) {
      replay.add(e);
      await service.ingest(e);
    }
    const snapshot = async (): Promise<string> =>
      JSON.stringify(
        (
          await h.admin.query(
            `SELECT metric_id, period_start, dimensions, value::text, contributor_count::int AS n
               FROM sf_analytics.metric_point WHERE definition_id = $1 ORDER BY metric_id`,
            [id],
          )
        ).rows,
      );
    const live = await snapshot();
    await h.admin.query(
      `UPDATE sf_analytics.metric_point SET value = value + 1000 WHERE definition_id = $1`,
      [id],
    );
    const res = await call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active_generation: 2, events_applied: 10 });
    expect(await snapshot()).toBe(live);
    const gens = await h.admin.query(
      `SELECT DISTINCT generation FROM sf_analytics.metric_point WHERE definition_id = $1`,
      [id],
    );
    expect(gens.rows).toEqual([{ generation: 2 }]);
    const st = await h.admin.query(
      `SELECT active_generation, building_generation, build_token FROM sf_analytics.projection_state WHERE definition_id = $1`,
      [id],
    );
    expect(st.rows[0]).toEqual({
      active_generation: 2,
      building_generation: null,
      build_token: null,
    });
  });

  it('live events during a rebuild land in both generations exactly once', async () => {
    state.ctx = ctxFor(T1);
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'LIVE_DURING',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    replay.events.length = 0;
    const history = Array.from({ length: 6 }, () =>
      submitted(T1, { service_code: 'H', channel: 'WEB' }),
    );
    for (const e of history) replay.add(e);
    const late = submitted(T1, { service_code: 'LATE', channel: 'WEB' });
    let fired = false;
    replay.onBatch = async () => {
      if (fired) return;
      fired = true;
      await service.ingest(late);
      replay.add(late);
    };
    const res = await call('POST', `${ROUTE}/${id}/rebuild`, {});
    replay.onBatch = null;
    expect(res.status).toBe(200);
    const rows = await h.admin.query(
      `SELECT dimensions->>'service_code' AS service, value::int AS value, generation
         FROM sf_analytics.metric_point WHERE definition_id = $1 ORDER BY 1`,
      [id],
    );
    expect(rows.rows).toEqual([
      { service: 'H', value: 6, generation: 2 },
      { service: 'LATE', value: 1, generation: 2 },
    ]);
  });

  it('two concurrent rebuilds: one wins the lease, the other is refused; nothing is double applied', async () => {
    state.ctx = ctxFor(T1);
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'CONCURRENT',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    replay.events.length = 0;
    for (let i = 0; i < 5; i += 1) replay.add(submitted(T1, { service_code: 'C', channel: 'WEB' }));
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    replay.onBatch = async () => {
      entered?.();
      await gate;
    };
    const first = call('POST', `${ROUTE}/${id}/rebuild`, {});
    await started;
    replay.onBatch = null;
    const second = await call('POST', `${ROUTE}/${id}/rebuild`, {});
    expect(second.status).toBe(409);
    expect(JSON.stringify((second.body as Body).details)).toContain('REBUILD_IN_PROGRESS');
    release?.();
    expect((await first).status).toBe(200);
    const value = await h.admin.query(
      `SELECT sum(value)::int AS v FROM sf_analytics.metric_point WHERE definition_id = $1`,
      [id],
    );
    expect(value.rows[0]?.['v']).toBe(5);
  });

  it('a stale generation cannot be activated by a superseded builder', async () => {
    state.ctx = ctxFor(T1);
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'SUPERSEDED',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    const repo = new PgAnalyticsRepository(asSqlPool(h.rt));
    const ctx = ctxFor(T1) as RequestContext & { tenant_id: string };
    const now = clock.now();
    await repo.withTx(ctx, (tx) =>
      tx.beginBuild({
        definitionId: id,
        token: '10000000-0000-4000-8000-000000000001',
        now,
        leaseMs: 1000,
      }),
    );
    const later = new Date(now.getTime() + 5000);
    await repo.withTx(ctx, (tx) =>
      tx.beginBuild({
        definitionId: id,
        token: '10000000-0000-4000-8000-000000000002',
        now: later,
        leaseMs: 1000,
      }),
    );
    await expect(
      repo.withTx(ctx, (tx) =>
        tx.activateBuild({
          definitionId: id,
          token: '10000000-0000-4000-8000-000000000001',
          now: later,
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(
      repo.withTx(ctx, (tx) =>
        tx.renewBuild({
          definitionId: id,
          token: '10000000-0000-4000-8000-000000000001',
          now: later,
          leaseMs: 1000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await repo.withTx(ctx, (tx) =>
      tx.activateBuild({
        definitionId: id,
        token: '10000000-0000-4000-8000-000000000002',
        now: later,
      }),
    );
  });

  it('the database rejects a PII-shaped dimension even if application validation were bypassed', async () => {
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'BYPASS_CHECK',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    const repo = new PgAnalyticsRepository(asSqlPool(h.rt));
    const ctx = ctxFor(T1) as RequestContext & { tenant_id: string };
    await expect(
      repo.withTx(ctx, (tx) =>
        tx.applyContribution({
          definition_id: id,
          generation: 1,
          event_id: '20000000-0000-4000-8000-000000000001',
          metric_code: 'BYPASS_CHECK',
          purpose_code: PURPOSE,
          period_start: '2026-10-05T00:00:00.000Z',
          period_end: '2026-10-06T00:00:00.000Z',
          dimensions: { service_code: 'ravi.kumar@example.org' },
          dimension_hash: `sha256:${'c'.repeat(64)}`,
          metric_id: '30000000-0000-4000-8000-000000000001',
          delta: 1,
          contributor_increment: 1,
          occurred_at: '2026-10-05T08:00:00.000Z',
          now: clock.now(),
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const n = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_analytics.projection_applied_event WHERE event_id = $1`,
      ['20000000-0000-4000-8000-000000000001'],
    );
    expect(n.rows[0]?.['n']).toBe(0);
  });

  it('a retired definition stops projecting and stays readable', async () => {
    const created = await call('POST', ROUTE, {
      ...COUNT_DEFINITION,
      metric_code: 'RETIRE_CHECK',
      min_cohort_size: 1,
    });
    const id = (created.body as Body).definition.definition_id as string;
    await service.ingest(submitted(T1, { service_code: 'R', channel: 'WEB' }));
    await call('POST', `${ROUTE}/${id}/retire`, {});
    await service.ingest(submitted(T1, { service_code: 'R2', channel: 'WEB' }));
    const live = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_analytics.metric_point WHERE definition_id = $1`,
      [id],
    );
    expect(live.rows[0]?.['n']).toBe(1);
    const read = await call('GET', '/v1/analytics/metrics', undefined, {
      metric_code: 'RETIRE_CHECK',
      purpose_code: PURPOSE,
    });
    expect(read.status).toBe(200);
    expect((read.body as Body).metrics).toHaveLength(1);
  });
});
