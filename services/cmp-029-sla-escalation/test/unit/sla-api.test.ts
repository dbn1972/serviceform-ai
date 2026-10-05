import { describe, expect, it } from 'vitest';
import { replayClock, verifyClockHistory, type ClockTransition } from '../../src/domain/clock.js';
import type { CalendarSpec } from '../../src/domain/calendar.js';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import type { CalendarRow, ClockRow, PolicyRow } from '../../src/repo/types.js';
import { calendarSpec, clockStateOf, policySpec } from '../../src/service/sla-service.js';
import { APPLICATION_ID, ctxFor, TENANT_A, TENANT_B } from '../doubles/fixtures.js';
import { makeHarness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('happy path: start, pause, resume, complete', () => {
  it('runs the full clock lifecycle on server time with auditable history', async () => {
    const h = makeHarness('2026-10-05T10:00:00Z');
    const { policyId } = await h.seed();
    const started = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(started.status).toBe(201);
    const clock = (started.body as Body).sla_clock;
    expect(clock).toMatchObject({
      contract_id: 'SF-CON-SLA-CLOCK',
      clock_status: 'RUNNING',
      deadline_at: '2026-10-07T10:00:00.000Z',
      server_computed_deadline: true,
      notification_port: 'M06_CMP025',
      escalation_level: 0,
    });
    const id = clock.clock_id as string;

    h.clock.set('2026-10-06T10:00:00Z');
    const paused = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'DEFICIENCY_OPEN',
    });
    expect(paused.status).toBe(200);
    expect((paused.body as Body).sla_clock).toMatchObject({
      clock_status: 'PAUSED',
      pause_reason_code: 'DEFICIENCY_OPEN',
      pause_allowed_by_published_sla: true,
    });

    h.clock.set('2026-10-08T09:00:00Z');
    const resumed = await h.call('POST', `/v1/sla-clocks/${id}/resume`, {});
    expect((resumed.body as Body).sla_clock).toMatchObject({
      clock_status: 'RUNNING',
      deadline_at: '2026-10-08T17:00:00.000Z',
    });

    h.clock.set('2026-10-09T09:30:00Z');
    const done = await h.call('POST', `/v1/sla-clocks/${id}/complete`, {
      completion_anchor: 'DECISION_RECORDED',
    });
    expect((done.body as Body).sla_clock.clock_status).toBe('COMPLETED');

    const history = await h.call('GET', `/v1/sla-clocks/${id}/history`, undefined, { key: null });
    expect((history.body as Body).history.map((e: Body) => e.operation)).toEqual([
      'START',
      'PAUSE',
      'RESUME',
      'COMPLETE',
    ]);
    expect((history.body as Body).history.every((e: Body) => e.actor_id && e.correlation_id)).toBe(
      true,
    );

    const mem = h.repo.tenant(TENANT_A);
    const rows = [...mem.history];
    const policy = [...mem.policies.values()][0] as PolicyRow;
    const cal = calendarSpec([...mem.calendars.values()][0] as CalendarRow) satisfies CalendarSpec;
    const transitions: ClockTransition[] = rows.map((r) => r);
    expect(verifyClockHistory(policySpec(policy), cal, transitions)).toEqual([]);
    expect(replayClock(transitions)).toEqual(clockStateOf([...mem.clocks.values()][0] as ClockRow));
  });

  it('serves the application-scoped read (Eng GET /applications/{id}/sla)', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    await h.startClock(policyId);
    const res = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
      key: null,
    });
    expect(res.status).toBe(200);
    expect((res.body as Body).clocks).toHaveLength(1);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('emits SLA domain events and audit through the outbox only', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' });
    const outbox = h.repo.tenant(TENANT_A).outbox;
    const domain = outbox.filter((o) => o.topic === TOPIC_DOMAIN).map((o) => o.envelope.event_type);
    expect(domain).toEqual(['SlaClockStarted', 'SlaClockPaused']);
    expect(outbox.some((o) => o.topic === 'sf.audit.ingest.v1')).toBe(true);
    for (const o of outbox) {
      expect(o.envelope.tenant_id).toBe(TENANT_A);
      expect(JSON.stringify(o.envelope)).not.toMatch(/email|sms|phone|mobile/i);
    }
  });
});

describe('negative: wrong tenant', () => {
  it('another tenant cannot read, pause, resume, complete or evaluate a clock (404, no leakage)', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    h.state.ctx = ctxFor(TENANT_B);
    const attempts = [
      await h.call('GET', `/v1/sla-clocks/${id}`, undefined, { key: null }),
      await h.call('GET', `/v1/sla-clocks/${id}/history`, undefined, { key: null }),
      await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }),
      await h.call('POST', `/v1/sla-clocks/${id}/resume`, {}),
      await h.call('POST', `/v1/sla-clocks/${id}/complete`, {
        completion_anchor: 'DECISION_RECORDED',
      }),
      await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {}),
    ];
    for (const r of attempts) {
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(TENANT_A);
      expect(JSON.stringify(r.body)).not.toContain(APPLICATION_ID);
    }
    const list = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
      key: null,
    });
    expect((list.body as Body).clocks).toEqual([]);
    expect(h.repo.tenant(TENANT_A).clocks.get(id)?.status).toBe('RUNNING');
  });

  it('another tenant cannot start a clock on a policy it does not own', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    h.state.ctx = ctxFor(TENANT_B);
    const res = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(res.status).toBe(404);
    expect(h.repo.tenant(TENANT_B).clocks.size).toBe(0);
  });

  it('refuses caller-asserted tenant identity headers before any work', async () => {
    const h = makeHarness();
    for (const name of ['x-tenant-id', 'X-SF-Tenant', 'x-roles', 'x-actor-type']) {
      const res = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
        key: null,
        headers: { [name]: TENANT_B },
      });
      expect(res.status).toBe(403);
      expect((res.body as Body).error_code).toBe('SF-TEN-002');
    }
    const fwd = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
      key: null,
      headers: { forwarded: `for=1.2.3.4;tenant=${TENANT_B}` },
    });
    expect(fwd.status).toBe(403);
  });

  it('requires a server-resolved tenant context', async () => {
    const h = makeHarness();
    h.state.ctx = null;
    expect(
      (
        await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
          key: null,
        })
      ).status,
    ).toBe(401);
    h.state.ctx = { ...ctxFor(TENANT_A), tenant_id: null };
    const res = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
      key: null,
    });
    expect(res.status).toBe(401);
    expect((res.body as Body).error_code).toBe('SF-TEN-001');
  });

  it('denies when the policy decision point denies, errors, or is unavailable (fail closed)', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    h.authorizer.deny = true;
    const denied = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(denied.status).toBe(403);
    expect(h.repo.tenant(TENANT_A).clocks.size).toBe(0);
    h.authorizer.deny = false;
    h.authorizer.fail = true;
    const down = await h.call('GET', `/v1/applications/${APPLICATION_ID}/sla-clocks`, undefined, {
      key: null,
    });
    expect(down.status).toBe(503);
  });
});

describe('negative: pause and resume rules', () => {
  it('rejects pause when the reason is not allowed by the published SLA, and audits the denial', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    const res = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'CITIZEN_REQUEST',
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error_code: 'SF-APP-001',
      details: [{ code: 'PAUSE_NOT_ALLOWED_BY_PUBLISHED_SLA' }],
    });
    expect(h.repo.tenant(TENANT_A).clocks.get(id)?.status).toBe('RUNNING');
    const audits = h.repo.tenant(TENANT_A).outbox.filter((o) => o.topic === 'sf.audit.ingest.v1');
    expect(audits.some((a) => (a.envelope.data as Body).result === 'DENIED')).toBe(true);
  });

  it('rejects pause for a policy that publishes no pause reasons', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed({ allowed_pause_reason_codes: [] });
    const id = await h.startClock(policyId);
    const res = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'DEFICIENCY_OPEN',
    });
    expect(res.status).toBe(409);
  });

  it('a caller cannot assert that the pause is allowed', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    const res = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'CITIZEN_REQUEST',
      pause_allowed_by_published_sla: true,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ details: [{ code: 'UNKNOWN_PROPERTY' }] });
  });

  it('rejects resume of a clock that is not paused', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    const res = await h.call('POST', `/v1/sla-clocks/${id}/resume`, {});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error_code: 'SF-APP-001',
      details: [{ code: 'CLOCK_NOT_PAUSED' }],
    });
  });

  it('rejects repeated pause and resume after resume', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    expect(
      (await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }))
        .status,
    ).toBe(200);
    expect(
      (await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }))
        .status,
    ).toBe(409);
    expect((await h.call('POST', `/v1/sla-clocks/${id}/resume`, {})).status).toBe(200);
    expect((await h.call('POST', `/v1/sla-clocks/${id}/resume`, {})).status).toBe(409);
  });

  it('refuses to pause once the deadline has elapsed (pause is not retroactive)', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    h.clock.set('2026-10-07T11:00:00Z');
    const res = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'DEFICIENCY_OPEN',
    });
    expect(res.body).toMatchObject({ details: [{ code: 'CLOCK_DEADLINE_ELAPSED' }] });
  });
});

describe('negative: client-supplied time is never authoritative', () => {
  const timeKeys = [
    'now',
    'clock_now',
    'occurred_at',
    'deadline_at',
    'timestamp',
    'effective_from',
    'started_at',
  ];

  it.each(timeKeys)('rejects %s in a command body', async (key) => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    const res = await h.call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'DEFICIENCY_OPEN',
      [key]: '2030-01-01T00:00:00Z',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      details: [{ code: 'CLIENT_TIME_NOT_AUTHORITATIVE', pointer: `/body/${key}` }],
    });
    expect(h.repo.tenant(TENANT_A).clocks.get(id)?.status).toBe('RUNNING');
  });

  it('rejects client time on start, resume, complete, evaluate and calendar/policy creation', async () => {
    const h = makeHarness();
    const { policyId, calendarId } = await h.seed();
    const id = await h.startClock(policyId);
    const bodies: [string, string, Body][] = [
      [
        'POST',
        '/v1/sla-clocks',
        {
          application_id: '55555555-5555-4555-8555-555555555551',
          policy_id: policyId,
          start_anchor: 'APPLICATION_RECEIVED',
          started_at: '2020-01-01T00:00:00Z',
        },
      ],
      ['POST', `/v1/sla-clocks/${id}/resume`, { now: '2030-01-01T00:00:00Z' }],
      [
        'POST',
        `/v1/sla-clocks/${id}/complete`,
        { completion_anchor: 'DECISION_RECORDED', completed_at: '2020-01-01T00:00:00Z' },
      ],
      ['POST', `/v1/sla-clocks/${id}/evaluate`, { as_of: '2031-01-01T00:00:00Z' }],
      [
        'POST',
        '/v1/sla-calendars',
        { calendar_code: 'X_CAL', effective_from: '2020-01-01T00:00:00Z' },
      ],
      [
        'POST',
        '/v1/sla-policies',
        { policy_code: 'X_POL', deadline: '2020-01-01T00:00:00Z', calendar_id: calendarId },
      ],
    ];
    for (const [method, path, body] of bodies) {
      const res = await h.call(method, path, body);
      expect(res.status, path).toBe(400);
    }
    expect(h.repo.tenant(TENANT_A).clocks.size).toBe(1);
  });

  it('rejects client time in query parameters', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    const res = await h.call('GET', `/v1/sla-clocks/${id}`, undefined, {
      key: null,
      query: { now: '2030-01-01T00:00:00Z' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ details: [{ code: 'CLIENT_TIME_NOT_AUTHORITATIVE' }] });
  });

  it('computes every deadline from the injected server clock', async () => {
    const early = makeHarness('2026-10-05T10:00:00Z');
    const late = makeHarness('2026-10-05T16:00:00Z');
    const a = await early.seed();
    const b = await late.seed();
    const ea = await early.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: a.policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    const lb = await late.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: b.policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect((ea.body as Body).sla_clock.deadline_at).toBe('2026-10-07T10:00:00.000Z');
    expect((lb.body as Body).sla_clock.deadline_at).toBe('2026-10-07T16:00:00.000Z');
  });
});

describe('negative: the clock cannot mutate case state', () => {
  it('has no case/application state dependency and emits only SLA events', async () => {
    const h = makeHarness();
    const deps = (h.service as unknown as { deps: Record<string, unknown> }).deps;
    expect(Object.keys(deps).sort()).toEqual(['authorizer', 'clock', 'notifier', 'repo']);

    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    h.clock.set('2026-10-07T10:00:00Z');
    await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    const topics = new Set(h.repo.tenant(TENANT_A).outbox.map((o) => o.topic));
    expect([...topics].sort()).toEqual(['sf.audit.ingest.v1', TOPIC_DOMAIN]);
    const types = h.repo
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === TOPIC_DOMAIN)
      .map((o) => o.envelope.event_type);
    expect(types).toEqual(['SlaClockStarted', 'SlaBreached', 'EscalationTriggered']);
    for (const t of types) expect(t).not.toMatch(/^(Application|Case|Workflow)/);
  });
});

describe('idempotency', () => {
  it('replays the stored response for the same key and body without a second effect', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const body = {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    };
    const first = await h.call('POST', '/v1/sla-clocks', body, { key: 'idem-start-0001' });
    h.clock.advanceMinutes(30);
    const second = await h.call('POST', '/v1/sla-clocks', body, { key: 'idem-start-0001' });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(h.repo.tenant(TENANT_A).clocks.size).toBe(1);
    expect(h.repo.tenant(TENANT_A).history).toHaveLength(1);
  });

  it('rejects a reused key with a different request and a missing/invalid key', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    await h.call(
      'POST',
      `/v1/sla-clocks/${id}/pause`,
      { reason_code: 'DEFICIENCY_OPEN' },
      { key: 'idem-pause-0001' },
    );
    const reuse = await h.call(
      'POST',
      `/v1/sla-clocks/${id}/pause`,
      { reason_code: 'OTHER_REASON' },
      { key: 'idem-pause-0001' },
    );
    expect(reuse.status).toBe(409);
    expect((reuse.body as Body).error_code).toBe('SF-APP-002');
    expect((await h.call('POST', `/v1/sla-clocks/${id}/resume`, {}, { key: null })).status).toBe(
      400,
    );
    expect((await h.call('POST', `/v1/sla-clocks/${id}/resume`, {}, { key: 'short' })).status).toBe(
      400,
    );
  });

  it('rejects a second clock for the same application stage', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    await h.startClock(policyId);
    const dup = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(dup.status).toBe(409);
    const other = await h.call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      stage_code: 'SCRUTINY',
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(other.status).toBe(201);
  });
});

describe('start preconditions and configuration', () => {
  it('rejects unknown, retired and anchor-mismatched policies and unknown routes', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const start = {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    };
    expect(
      (
        await h.call('POST', '/v1/sla-clocks', {
          ...start,
          policy_id: '12121212-1212-4212-8212-121212121212',
        })
      ).status,
    ).toBe(404);
    const mismatch = await h.call('POST', '/v1/sla-clocks', {
      ...start,
      start_anchor: 'PAYMENT_CONFIRMED',
    });
    expect(mismatch.body).toMatchObject({ details: [{ code: 'START_ANCHOR_MISMATCH' }] });
    expect((await h.call('POST', `/v1/sla-policies/${policyId}/retire`, {})).status).toBe(200);
    const retired = await h.call('POST', '/v1/sla-clocks', start);
    expect(retired.body).toMatchObject({ details: [{ code: 'POLICY_NOT_PUBLISHED' }] });
    expect((await h.call('POST', `/v1/sla-policies/${policyId}/retire`, {})).status).toBe(409);
    expect((await h.call('GET', '/v1/nope', undefined, { key: null })).status).toBe(404);
    expect((await h.call('DELETE', '/v1/sla-clocks', undefined, { key: null })).status).toBe(400);
  });

  it('fails explicitly when the pinned calendar version is unavailable', async () => {
    const h = makeHarness();
    const { calendarId } = await h.seed();
    const res = await h.call('POST', '/v1/sla-policies', {
      ...(await import('../doubles/fixtures.js')).policyBody(
        '12121212-1212-4212-8212-121212121212',
      ),
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ details: [{ code: 'CALENDAR_UNAVAILABLE' }] });
    expect(calendarId).toBeTruthy();
  });

  it('versions calendars and policies; published versions never change', async () => {
    const h = makeHarness();
    const first = await h.seed();
    const cal2 = await h.call('POST', '/v1/sla-calendars', {
      ...(await import('../doubles/fixtures.js')).CALENDAR_BODY,
      holidays: ['2026-10-06'],
    });
    expect((cal2.body as Body).version_no).toBe(2);
    const id = await h.startClock(first.policyId);
    expect(h.repo.tenant(TENANT_A).clocks.get(id)?.calendar_id).toBe(first.calendarId);
  });

  it.each([
    ['/v1/sla-calendars', { calendar_code: 'bad code' }],
    [
      '/v1/sla-calendars',
      {
        calendar_code: 'C_ONE',
        utc_offset_minutes: 0,
        working_weekdays: [9],
        window_start_minute: 0,
        window_end_minute: 10,
        holidays: [],
      },
    ],
    ['/v1/sla-policies', { policy_code: 'P_ONE' }],
  ])('validates %s', async (path, body) => {
    const h = makeHarness();
    const res = await h.call('POST', path, body);
    expect(res.status).toBe(400);
    expect((res.body as Body).error_code).toBe('SF-SYS-003');
  });

  it('validates escalation schedules', async () => {
    const h = makeHarness();
    const { calendarId } = await h.seed();
    const { policyBody } = await import('../doubles/fixtures.js');
    const nonConsecutive = await h.call(
      'POST',
      '/v1/sla-policies',
      policyBody(calendarId, {
        escalation_schedule: [{ level: 2, after_deadline_minutes: 0, action_code: 'ESC_A' }],
      }),
    );
    expect(nonConsecutive.status).toBe(400);
    const decreasing = await h.call(
      'POST',
      '/v1/sla-policies',
      policyBody(calendarId, {
        escalation_schedule: [
          { level: 1, after_deadline_minutes: 10, action_code: 'ESC_A' },
          { level: 2, after_deadline_minutes: 5, action_code: 'ESC_B' },
        ],
      }),
    );
    expect(decreasing.status).toBe(400);
    const warn = await h.call(
      'POST',
      '/v1/sla-policies',
      policyBody(calendarId, { warning_before_minutes: 5000 }),
    );
    expect(warn.status).toBe(400);
  });
});

describe('breach, escalation and the CMP-025 port', () => {
  it('breaches and escalates on the policy schedule and requests notification via the port only', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);

    h.clock.set('2026-10-06T16:30:00Z');
    const warn = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((warn.body as Body).transitions.map((t: Body) => t.operation)).toEqual(['WARN']);

    h.clock.set('2026-10-07T10:00:00Z');
    const breach = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((breach.body as Body).sla_clock).toMatchObject({
      clock_status: 'BREACHED',
      escalation_level: 1,
      breach_at: '2026-10-07T10:00:00.000Z',
    });

    h.clock.set('2026-10-08T10:00:00Z');
    const level2 = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((level2.body as Body).sla_clock.escalation_level).toBe(2);

    expect(
      h.notifier.requests.map((r) => [r.kind, r.escalation_level, r.escalation_action_code]),
    ).toEqual([
      ['SLA_BREACH_APPROACHING', 0, null],
      ['SLA_BREACHED', 0, null],
      ['SLA_ESCALATED', 1, 'ESCALATE_SUPERVISOR'],
      ['SLA_ESCALATED', 2, 'ESCALATE_HEAD'],
    ]);
    for (const r of h.notifier.requests) {
      expect(r.notification_port).toBe('M06_CMP025');
      expect(Object.keys(r).sort()).toEqual([
        'application_id',
        'clock_id',
        'escalation_action_code',
        'escalation_level',
        'kind',
        'notification_port',
        'source_event_id',
        'tenant_id',
      ]);
    }
    const repeat = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((repeat.body as Body).transitions).toEqual([]);
  });

  it('keeps SLA state when the notification port fails', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    h.notifier.fail = true;
    h.clock.set('2026-10-07T10:00:00Z');
    const res = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect(res.status).toBe(200);
    expect(h.repo.tenant(TENANT_A).clocks.get(id)?.status).toBe('BREACHED');
  });

  it('does not send notifications from within the transaction', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    let sawTx: boolean | undefined;
    h.notifier.requestNotification = (): Promise<void> => {
      sawTx = h.repo.inTransaction();
      return Promise.resolve();
    };
    h.clock.set('2026-10-07T10:00:00Z');
    await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect(sawTx).toBe(false);
  });

  it('a paused clock never breaches', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    const id = await h.startClock(policyId);
    await h.call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' });
    h.clock.set('2027-01-01T00:00:00Z');
    const res = await h.call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((res.body as Body).sla_clock.clock_status).toBe('PAUSED');
    expect(h.notifier.requests).toEqual([]);
  });
});

describe('INT-009 deficiency pause/resume port', () => {
  it('pauses and resumes through the port with the same policy checks', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    await h.startClock(policyId);
    const ctx = ctxFor(TENANT_A, '44444444-4444-4444-8444-444444444444', 'SYSTEM');
    h.clock.set('2026-10-06T10:00:00Z');
    const paused = await h.service.pauseForDeficiency(ctx as never, {
      application_id: APPLICATION_ID,
      reason_code: 'DEFICIENCY_OPEN',
      idempotency_key: 'int009-pause-0001',
    });
    expect(paused).toMatchObject({ clock_status: 'PAUSED', pause_reason_code: 'DEFICIENCY_OPEN' });
    const replay = await h.service.pauseForDeficiency(ctx as never, {
      application_id: APPLICATION_ID,
      reason_code: 'DEFICIENCY_OPEN',
      idempotency_key: 'int009-pause-0001',
    });
    expect(replay).toEqual(paused);
    h.clock.set('2026-10-08T09:00:00Z');
    const resumed = await h.service.resumeAfterDeficiency(ctx as never, {
      application_id: APPLICATION_ID,
      reason_code: 'DEFICIENCY_CLOSED',
      idempotency_key: 'int009-resume-0001',
    });
    expect(resumed).toMatchObject({
      clock_status: 'RUNNING',
      deadline_at: '2026-10-08T17:00:00.000Z',
      pause_reason_code: null,
    });
  });

  it('refuses an unpublished pause reason and a missing clock', async () => {
    const h = makeHarness();
    const { policyId } = await h.seed();
    await h.startClock(policyId);
    const ctx = ctxFor(TENANT_A, '44444444-4444-4444-8444-444444444444', 'SYSTEM') as never;
    await expect(
      h.service.pauseForDeficiency(ctx, {
        application_id: APPLICATION_ID,
        reason_code: 'NOT_PUBLISHED',
        idempotency_key: 'int009-pause-0002',
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(
      h.service.resumeAfterDeficiency(ctx, {
        application_id: APPLICATION_ID,
        reason_code: 'DEFICIENCY_CLOSED',
        idempotency_key: 'int009-resume-0002',
      }),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    await expect(
      h.service.pauseForDeficiency(ctx, {
        application_id: '12121212-1212-4212-8212-121212121212',
        reason_code: 'DEFICIENCY_OPEN',
        idempotency_key: 'int009-pause-0003',
      }),
    ).rejects.toMatchObject({ code: 'SF-SYS-002' });
  });
});
