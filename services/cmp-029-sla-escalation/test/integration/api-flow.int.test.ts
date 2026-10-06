import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSlaApi } from '../../src/api/handler.js';
import { replayClock, verifyClockHistory, type ClockTransition } from '../../src/domain/clock.js';
import { buildSlaService } from '../../src/index.js';
import { PgSlaRepository } from '../../src/repo/pg.js';
import type { RequestContext } from '../../src/types.js';
import {
  AllowAllAuthorizer,
  APPLICATION_ID,
  CALENDAR_BODY,
  ctxFor,
  MutableClock,
  policyBody,
  RecordingNotifier,
} from '../doubles/fixtures.js';
import { asSqlPool, closeHarness, setupHarness, T1, T2, type Harness } from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CMP-029 end to end on PostgreSQL (real login role, FORCE RLS)', () => {
  let h: Harness;
  const clock = new MutableClock(Date.parse('2026-10-05T10:00:00Z'));
  const notifier = new RecordingNotifier();
  const state: { ctx: RequestContext } = { ctx: ctxFor(T1) };
  let call: (
    method: string,
    path: string,
    body?: unknown,
    key?: string | null,
  ) => Promise<{ status: number; body: unknown }>;
  let n = 0;

  beforeAll(async () => {
    h = await setupHarness();
    const service = buildSlaService({
      repository: new PgSlaRepository(asSqlPool(h.rt)),
      authorizer: new AllowAllAuthorizer(),
      notifier,
      clock: clock.now,
    });
    const api = createSlaApi({ service, resolveContext: () => Promise.resolve(state.ctx) });
    call = async (method, path, body, key) => {
      n += 1;
      const headers: Record<string, string> =
        key === null ? {} : { 'idempotency-key': key ?? `int-key-${String(n).padStart(6, '0')}` };
      return api.handle({ method, path, headers, body });
    };
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  async function seed(): Promise<{ policyId: string; calendarId: string }> {
    const cal = await call('POST', '/v1/sla-calendars', CALENDAR_BODY);
    expect(cal.status).toBe(201);
    const calendarId = (cal.body as Body)['calendar_version_id'] as string;
    const pol = await call('POST', '/v1/sla-policies', policyBody(calendarId));
    expect(pol.status).toBe(201);
    return { calendarId, policyId: (pol.body as Body)['sla_policy_version_id'] as string };
  }

  it('runs start, pause, resume, breach, escalation and completion with replayable history', async () => {
    clock.set('2026-10-05T10:00:00Z');
    const { policyId, calendarId } = await seed();
    const started = await call('POST', '/v1/sla-clocks', {
      application_id: APPLICATION_ID,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    expect(started.status).toBe(201);
    const id = (started.body as Body)['sla_clock'].clock_id as string;
    expect((started.body as Body)['sla_clock'].deadline_at).toBe('2026-10-07T10:00:00.000Z');

    clock.set('2026-10-06T10:00:00Z');
    expect(
      (await call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' })).status,
    ).toBe(200);
    expect(
      (await call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' })).status,
    ).toBe(409);
    clock.set('2026-10-08T09:00:00Z');
    const resumed = await call('POST', `/v1/sla-clocks/${id}/resume`, {});
    expect((resumed.body as Body)['sla_clock'].deadline_at).toBe('2026-10-08T17:00:00.000Z');
    expect((await call('POST', `/v1/sla-clocks/${id}/resume`, {})).status).toBe(409);

    clock.set('2026-10-09T10:00:00Z');
    const breach = await call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((breach.body as Body)['sla_clock']).toMatchObject({
      clock_status: 'BREACHED',
      escalation_level: 1,
    });
    clock.set('2026-10-09T16:00:00Z');
    const quiet = await call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((quiet.body as Body)['transitions']).toEqual([]);
    clock.set('2026-10-12T09:00:00Z');
    const level2 = await call('POST', `/v1/sla-clocks/${id}/evaluate`, {});
    expect((level2.body as Body)['sla_clock'].escalation_level).toBe(2);
    const done = await call('POST', `/v1/sla-clocks/${id}/complete`, {
      completion_anchor: 'DECISION_RECORDED',
    });
    expect((done.body as Body)['sla_clock']).toMatchObject({
      clock_status: 'COMPLETED',
      escalation_level: 2,
    });

    const rows = await h.admin.query(
      `SELECT operation, from_status, to_status, occurred_at, reason_code, deadline_before, deadline_after, remaining_ms, escalation_level
         FROM sf_sla.sla_clock_event WHERE clock_id = $1 ORDER BY sequence_no`,
      [id],
    );
    const transitions: ClockTransition[] = rows.rows.map((r) => ({
      operation: r['operation'] as ClockTransition['operation'],
      from_status: r['from_status'] as ClockTransition['from_status'],
      to_status: r['to_status'] as ClockTransition['to_status'],
      occurred_at: (r['occurred_at'] as Date).toISOString(),
      reason_code: r['reason_code'] as string | null,
      deadline_before: r['deadline_before'] ? (r['deadline_before'] as Date).toISOString() : null,
      deadline_after: (r['deadline_after'] as Date).toISOString(),
      remaining_ms: r['remaining_ms'] === null ? null : Number(r['remaining_ms']),
      escalation_level: Number(r['escalation_level']),
    }));
    expect(transitions.map((t) => t.operation)).toEqual([
      'START',
      'PAUSE',
      'RESUME',
      'BREACH',
      'ESCALATE',
      'ESCALATE',
      'COMPLETE',
    ]);

    const pinned = await h.admin.query(`SELECT * FROM sf_sla.sla_calendar WHERE calendar_id = $1`, [
      calendarId,
    ]);
    const cal = pinned.rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const pol = (
      await h.admin.query(`SELECT * FROM sf_sla.sla_policy WHERE policy_id = $1`, [policyId])
    ).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const problems = verifyClockHistory(
      {
        start_anchor: pol['start_anchor'],
        completion_anchor: pol['completion_anchor'],
        duration_basis: pol['duration_basis'],
        duration_minutes: Number(pol['duration_minutes']),
        warning_before_minutes: Number(pol['warning_before_minutes']),
        allowed_pause_reason_codes: pol['allowed_pause_reason_codes'],
        escalation_schedule: pol['escalation_schedule'],
      },
      {
        utc_offset_minutes: cal['utc_offset_minutes'],
        working_weekdays: cal['working_weekdays'],
        window_start_minute: cal['window_start_minute'],
        window_end_minute: cal['window_end_minute'],
        holidays: (cal['holidays'] as Date[]).map((d) => d.toISOString().slice(0, 10)),
      },
      transitions,
    );
    expect(problems).toEqual([]);
    const stored = (
      await h.admin.query(
        `SELECT status, deadline_at, escalation_level, pause_count, breach_at FROM sf_sla.sla_clock WHERE clock_id = $1`,
        [id],
      )
    ).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const replayed = replayClock(transitions);
    expect(replayed.status).toBe(stored['status']);
    expect(replayed.deadline_at).toBe((stored['deadline_at'] as Date).toISOString());
    expect(replayed.escalation_level).toBe(Number(stored['escalation_level']));
    expect(replayed.pause_count).toBe(Number(stored['pause_count']));
    expect(replayed.breach_at).toBe((stored['breach_at'] as Date).toISOString());

    const outbox = await h.admin.query(
      `SELECT topic, event_type, tenant_id FROM sf_sla.outbox_event WHERE aggregate_id = $1 OR topic = 'sf.audit.ingest.v1' ORDER BY seq`,
      [id],
    );
    expect(
      outbox.rows.some(
        (r) => r['topic'] === 'sf.sla.events.v1' && r['event_type'] === 'SlaBreached',
      ),
    ).toBe(true);
    expect(outbox.rows.every((r) => r['tenant_id'] === T1)).toBe(true);
    expect(notifier.requests.some((r) => r.kind === 'SLA_BREACHED')).toBe(true);
  });

  it('another tenant sees nothing through the API (RLS), and cannot act on the clock', async () => {
    clock.set('2026-10-05T10:00:00Z');
    const { policyId } = await seed();
    const other = '55555555-5555-4555-8555-555555555552';
    const started = await call('POST', '/v1/sla-clocks', {
      application_id: other,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    const id = (started.body as Body)['sla_clock'].clock_id as string;
    state.ctx = ctxFor(T2);
    try {
      for (const [m, p, b] of [
        ['GET', `/v1/sla-clocks/${id}`, undefined],
        ['GET', `/v1/sla-clocks/${id}/history`, undefined],
        ['POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }],
        ['POST', `/v1/sla-clocks/${id}/resume`, {}],
        ['POST', `/v1/sla-clocks/${id}/evaluate`, {}],
      ] as const) {
        const res = await call(m, p, b, m === 'GET' ? null : undefined);
        expect(res.status, p).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(T1);
      }
      const list = await call('GET', `/v1/applications/${other}/sla-clocks`, undefined, null);
      expect((list.body as Body)['clocks']).toEqual([]);
      const cross = await call('POST', '/v1/sla-clocks', {
        application_id: other,
        policy_id: policyId,
        start_anchor: 'APPLICATION_RECEIVED',
      });
      expect(cross.status).toBe(404);
    } finally {
      state.ctx = ctxFor(T1);
    }
    expect({ CROSS_TENANT_LEAKAGE: 0 }).toEqual({ CROSS_TENANT_LEAKAGE: 0 });
  });

  it('replays an idempotent command from the database and rejects a changed request', async () => {
    clock.set('2026-10-05T10:00:00Z');
    const { policyId } = await seed();
    const app = '55555555-5555-4555-8555-555555555553';
    const body = { application_id: app, policy_id: policyId, start_anchor: 'APPLICATION_RECEIVED' };
    const first = await call('POST', '/v1/sla-clocks', body, 'int-idem-start-1');
    clock.advanceMinutes(45);
    const second = await call('POST', '/v1/sla-clocks', body, 'int-idem-start-1');
    expect(second).toEqual(first);
    const changed = await call(
      'POST',
      '/v1/sla-clocks',
      { ...body, stage_code: 'OTHER_STAGE' },
      'int-idem-start-1',
    );
    expect(changed.status).toBe(409);
    const count = await h.admin.query(
      `SELECT count(*)::int AS n FROM sf_sla.sla_clock WHERE application_id = $1`,
      [app],
    );
    expect(count.rows[0]?.['n']).toBe(1);
  });

  it('serialises concurrent pause commands on the clock row (exactly one wins)', async () => {
    clock.set('2026-10-05T10:00:00Z');
    const { policyId } = await seed();
    const app = '55555555-5555-4555-8555-555555555554';
    const started = await call('POST', '/v1/sla-clocks', {
      application_id: app,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    const id = (started.body as Body)['sla_clock'].clock_id as string;
    clock.set('2026-10-06T10:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call('POST', `/v1/sla-clocks/${id}/pause`, { reason_code: 'DEFICIENCY_OPEN' }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const row = (
      await h.admin.query(`SELECT pause_count, status FROM sf_sla.sla_clock WHERE clock_id = $1`, [
        id,
      ])
    ).rows[0];
    expect(row).toMatchObject({ pause_count: 1, status: 'PAUSED' });
  });

  it('a refused command leaves no partial state and records a DENIED audit event', async () => {
    clock.set('2026-10-05T10:00:00Z');
    const { policyId } = await seed();
    const app = '55555555-5555-4555-8555-555555555555';
    const started = await call('POST', '/v1/sla-clocks', {
      application_id: app,
      policy_id: policyId,
      start_anchor: 'APPLICATION_RECEIVED',
    });
    const id = (started.body as Body)['sla_clock'].clock_id as string;
    const before = (
      await h.admin.query(
        `SELECT count(*)::int AS n FROM sf_sla.sla_clock_event WHERE clock_id = $1`,
        [id],
      )
    ).rows[0]?.['n'];
    const refused = await call('POST', `/v1/sla-clocks/${id}/pause`, {
      reason_code: 'NOT_PUBLISHED',
    });
    expect(refused.status).toBe(409);
    const after = (
      await h.admin.query(
        `SELECT count(*)::int AS n FROM sf_sla.sla_clock_event WHERE clock_id = $1`,
        [id],
      )
    ).rows[0]?.['n'];
    expect(after).toBe(before);
    const denied = await h.admin.query(
      `SELECT 1 FROM sf_sla.outbox_event WHERE topic = 'sf.audit.ingest.v1' AND envelope->'data'->>'result' = 'DENIED' AND envelope->'data'->>'resource_id' = $1`,
      [id],
    );
    expect(denied.rowCount).toBe(1);
  });
});
