import { describe, expect, it } from 'vitest';
import type { CalendarSpec } from '../../src/domain/calendar.js';
import {
  applyTransition,
  ClockRuleViolation,
  decideComplete,
  decidePause,
  decideResume,
  evaluateClock,
  replayClock,
  startClock,
  verifyClockHistory,
  type ClockTransition,
  type PolicySpec,
} from '../../src/domain/clock.js';

const cal: CalendarSpec = {
  utc_offset_minutes: 0,
  working_weekdays: [1, 2, 3, 4, 5],
  window_start_minute: 540,
  window_end_minute: 1020,
  holidays: ['2026-10-12'],
};
const policy: PolicySpec = {
  start_anchor: 'APPLICATION_RECEIVED',
  completion_anchor: 'DECISION_RECORDED',
  duration_basis: 'WORKING_MINUTES',
  duration_minutes: 960,
  warning_before_minutes: 120,
  allowed_pause_reason_codes: ['DEFICIENCY_OPEN'],
  escalation_schedule: [
    { level: 1, after_deadline_minutes: 0, action_code: 'ESCALATE_SUPERVISOR' },
    { level: 2, after_deadline_minutes: 480, action_code: 'ESCALATE_HEAD' },
  ],
};
const ms = (iso: string): number => Date.parse(iso);

function started(): ReturnType<typeof startClock> {
  return startClock(policy, cal, ms('2026-10-05T10:00:00Z'));
}

function violation(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ClockRuleViolation) return e.rule;
    throw e;
  }
  return 'NO_VIOLATION';
}

describe('start', () => {
  it('computes the deadline on the server from the pinned policy and calendar', () => {
    const { state, transition } = started();
    expect(state.status).toBe('RUNNING');
    expect(state.deadline_at).toBe('2026-10-07T10:00:00.000Z');
    expect(transition.operation).toBe('START');
  });
});

describe('pause / resume', () => {
  it('pauses with an allowed reason, preserving remaining working time', () => {
    const { state } = started();
    const pause = decidePause(state, policy, cal, ms('2026-10-06T10:00:00Z'), 'DEFICIENCY_OPEN');
    expect(pause.to_status).toBe('PAUSED');
    // Tue 10:00 -> Tue 17:00 (420) + Wed 09:00-10:00 (60)
    expect(pause.remaining_ms).toBe(480 * 60_000);
    const paused = applyTransition(state, pause);
    expect(paused.pause_count).toBe(1);
    expect(paused.deadline_at).toBe(state.deadline_at);
  });

  it('rejects a reason not listed by the published SLA', () => {
    const { state } = started();
    expect(
      violation(() =>
        decidePause(state, policy, cal, ms('2026-10-06T10:00:00Z'), 'CITIZEN_REQUEST'),
      ),
    ).toBe('PAUSE_NOT_ALLOWED_BY_PUBLISHED_SLA');
  });

  it('rejects pause of a clock that is not running or whose deadline elapsed', () => {
    const { state } = started();
    const pausedState = applyTransition(
      state,
      decidePause(state, policy, cal, ms('2026-10-06T10:00:00Z'), 'DEFICIENCY_OPEN'),
    );
    expect(
      violation(() =>
        decidePause(pausedState, policy, cal, ms('2026-10-06T11:00:00Z'), 'DEFICIENCY_OPEN'),
      ),
    ).toBe('CLOCK_NOT_RUNNING');
    expect(
      violation(() =>
        decidePause(state, policy, cal, ms('2026-10-07T10:00:00Z'), 'DEFICIENCY_OPEN'),
      ),
    ).toBe('CLOCK_DEADLINE_ELAPSED');
  });

  it('rejects resume of a clock that is not paused', () => {
    const { state } = started();
    expect(violation(() => decideResume(state, policy, cal, ms('2026-10-06T10:00:00Z')))).toBe(
      'CLOCK_NOT_PAUSED',
    );
  });

  it('resume recomputes the deadline from remaining time and the pinned calendar', () => {
    const { state } = started();
    const pause = decidePause(state, policy, cal, ms('2026-10-06T10:00:00Z'), 'DEFICIENCY_OPEN');
    const paused = applyTransition(state, pause);
    // Resume Thu 2026-10-08 09:00 with 480 working minutes left -> Thu 17:00
    const resume = decideResume(paused, policy, cal, ms('2026-10-08T09:00:00Z'));
    const running = applyTransition(paused, resume);
    expect(running.status).toBe('RUNNING');
    expect(running.deadline_at).toBe('2026-10-08T17:00:00.000Z');
    expect(running.paused_at).toBeNull();
    expect(running.remaining_ms).toBeNull();
  });

  it('time spent paused does not consume the SLA', () => {
    const { state } = started();
    const paused = applyTransition(
      state,
      decidePause(state, policy, cal, ms('2026-10-05T12:00:00Z'), 'DEFICIENCY_OPEN'),
    );
    expect(evaluateClock(paused, policy, cal, ms('2026-12-01T12:00:00Z'))).toEqual([]);
  });
});

describe('complete', () => {
  it('requires the published completion anchor and a resumed clock', () => {
    const { state } = started();
    expect(
      violation(() => decideComplete(state, policy, ms('2026-10-06T10:00:00Z'), 'CASE_CLOSED')),
    ).toBe('COMPLETION_ANCHOR_MISMATCH');
    const paused = applyTransition(
      state,
      decidePause(state, policy, cal, ms('2026-10-06T10:00:00Z'), 'DEFICIENCY_OPEN'),
    );
    expect(
      violation(() =>
        decideComplete(paused, policy, ms('2026-10-06T11:00:00Z'), 'DECISION_RECORDED'),
      ),
    ).toBe('CLOCK_PAUSED_RESUME_REQUIRED');
    const done = applyTransition(
      state,
      decideComplete(state, policy, ms('2026-10-06T10:00:00Z'), 'DECISION_RECORDED'),
    );
    expect(done.status).toBe('COMPLETED');
    expect(
      violation(() =>
        decideComplete(done, policy, ms('2026-10-06T11:00:00Z'), 'DECISION_RECORDED'),
      ),
    ).toBe('CLOCK_ALREADY_COMPLETED');
  });

  it('a late completion keeps the breach record', () => {
    const { state } = started();
    const after = ms('2026-10-07T11:00:00Z');
    let s = state;
    for (const t of evaluateClock(s, policy, cal, after)) s = applyTransition(s, t);
    expect(s.status).toBe('BREACHED');
    const done = applyTransition(s, decideComplete(s, policy, after, 'DECISION_RECORDED'));
    expect(done.status).toBe('COMPLETED');
    expect(done.breach_at).toBe('2026-10-07T10:00:00.000Z');
  });
});

describe('evaluate: warning, breach, escalation', () => {
  it('emits one approaching-breach warning inside the warning window', () => {
    const { state } = started();
    const out = evaluateClock(state, policy, cal, ms('2026-10-06T15:30:00Z'));
    expect(out).toEqual([]);
    const warn = evaluateClock(state, policy, cal, ms('2026-10-06T16:30:00Z'));
    expect(warn.map((t) => t.operation)).toEqual(['WARN']);
    const warned = applyTransition(state, warn[0] as ClockTransition);
    expect(evaluateClock(warned, policy, cal, ms('2026-10-06T16:45:00Z'))).toEqual([]);
  });

  it('breaches at the deadline and escalates level by level on the policy schedule', () => {
    const { state } = started();
    const at0 = evaluateClock(state, policy, cal, ms('2026-10-07T10:00:00Z'));
    expect(at0.map((t) => [t.operation, t.escalation_level])).toEqual([
      ['BREACH', 0],
      ['ESCALATE', 1],
    ]);
    let s = state;
    for (const t of at0) s = applyTransition(s, t);
    expect(s.breach_at).toBe('2026-10-07T10:00:00.000Z');
    expect(s.escalation_level).toBe(1);
    // 480 working minutes after the deadline: Wed 10:00-17:00 (420) + Thu 09:00-10:00 (60)
    expect(evaluateClock(s, policy, cal, ms('2026-10-08T09:30:00Z'))).toEqual([]);
    const level2 = evaluateClock(s, policy, cal, ms('2026-10-08T10:00:00Z'));
    expect(level2.map((t) => [t.operation, t.escalation_level, t.reason_code])).toEqual([
      ['ESCALATE', 2, 'ESCALATE_HEAD'],
    ]);
  });

  it('is idempotent: re-evaluating the same instant yields no further transitions', () => {
    const { state } = started();
    let s = state;
    for (const t of evaluateClock(s, policy, cal, ms('2026-10-09T10:00:00Z')))
      s = applyTransition(s, t);
    expect(evaluateClock(s, policy, cal, ms('2026-10-09T10:00:00Z'))).toEqual([]);
  });
});

describe('auditable history and deterministic replay', () => {
  function fullHistory(): ClockTransition[] {
    const out: ClockTransition[] = [];
    const first = started();
    out.push(first.transition);
    let s = first.state;
    const push = (t: ClockTransition): void => {
      out.push(t);
      s = applyTransition(s, t);
    };
    push(decidePause(s, policy, cal, ms('2026-10-06T10:00:00Z'), 'DEFICIENCY_OPEN'));
    push(decideResume(s, policy, cal, ms('2026-10-08T09:00:00Z')));
    for (const t of evaluateClock(s, policy, cal, ms('2026-10-08T17:30:00Z'))) push(t);
    push(decideComplete(s, policy, ms('2026-10-09T09:30:00Z'), 'DECISION_RECORDED'));
    return out;
  }

  it('replays to the same final state every time', () => {
    const history = fullHistory();
    const a = replayClock(history);
    const b = replayClock(structuredClone(history));
    expect(a).toEqual(b);
    expect(a.status).toBe('COMPLETED');
    expect(a.pause_count).toBe(1);
  });

  it('verifies a genuine history against the pinned policy and calendar', () => {
    expect(verifyClockHistory(policy, cal, fullHistory())).toEqual([]);
  });

  it('detects a silently edited deadline', () => {
    const history = fullHistory();
    const resume = history.find((t) => t.operation === 'RESUME') as ClockTransition;
    resume.deadline_after = '2026-10-30T17:00:00.000Z';
    expect(verifyClockHistory(policy, cal, history)).toContain('SEQ_3_DEADLINE_DRIFT');
  });

  it('detects deadline edits on a non-resume transition and a broken status chain', () => {
    const h1 = fullHistory();
    (h1[3] as ClockTransition).deadline_after = '2026-11-01T00:00:00.000Z';
    expect(verifyClockHistory(policy, cal, h1).some((p) => p.endsWith('DEADLINE_EDITED'))).toBe(
      true,
    );
    const h2 = fullHistory();
    (h2[1] as ClockTransition).from_status = 'COMPLETED';
    expect(verifyClockHistory(policy, cal, h2)).toContain('SEQ_2_FROM_STATUS_MISMATCH');
    const h3 = fullHistory().slice(1);
    expect(verifyClockHistory(policy, cal, h3)).toContain('FIRST_EVENT_NOT_START');
  });

  it('rejects replay of an empty history or one that does not start with START', () => {
    expect(() => replayClock([])).toThrow();
    const h = fullHistory();
    expect(() => replayClock(h.slice(1))).toThrow();
  });

  it('a later calendar version never alters a pinned clock', () => {
    const { state } = started();
    const laterCal: CalendarSpec = { ...cal, holidays: ['2026-10-06', '2026-10-07'] };
    // Pinned calendar still drives evaluation of the existing clock.
    expect(
      evaluateClock(state, policy, cal, ms('2026-10-07T10:00:00Z')).map((t) => t.operation),
    ).toContain('BREACH');
    expect(startClock(policy, laterCal, ms('2026-10-05T10:00:00Z')).state.deadline_at).not.toBe(
      state.deadline_at,
    );
  });
});
