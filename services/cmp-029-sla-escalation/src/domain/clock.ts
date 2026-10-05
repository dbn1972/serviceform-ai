/**
 * SLA clock decision and replay logic (Constitution #16, SF-CON-SLA-CLOCK).
 *
 * Every function is pure: time is always an argument supplied by the server-side service clock,
 * never read here and never taken from a client. State changes are expressed as
 * `ClockTransition` values; `applyTransition` is the only reducer, shared by the live service
 * and by `replayClock`, so history replays deterministically to the stored state.
 *
 * CMP-029 owns SLA state only. Nothing in this module references case state; CMP-015 stays
 * authoritative for application/case status.
 */
import {
  addDuration,
  durationBetween,
  MS_PER_MINUTE,
  type CalendarSpec,
  type DurationBasis,
} from './calendar.js';

export type ClockStatus = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'BREACHED';
export type ClockOperation =
  'START' | 'PAUSE' | 'RESUME' | 'COMPLETE' | 'WARN' | 'BREACH' | 'ESCALATE';

export interface EscalationStep {
  level: number;
  after_deadline_minutes: number;
  action_code: string;
}

export interface PolicySpec {
  start_anchor: string;
  completion_anchor: string;
  duration_basis: DurationBasis;
  duration_minutes: number;
  warning_before_minutes: number | null;
  allowed_pause_reason_codes: readonly string[];
  escalation_schedule: readonly EscalationStep[];
}

export interface ClockState {
  status: ClockStatus;
  started_at: string;
  deadline_at: string;
  remaining_ms: number | null;
  paused_at: string | null;
  pause_reason_code: string | null;
  pause_count: number;
  resumed_at: string | null;
  completed_at: string | null;
  breach_at: string | null;
  warning_emitted_at: string | null;
  escalation_level: number;
}

export interface ClockTransition {
  operation: ClockOperation;
  from_status: ClockStatus | null;
  to_status: ClockStatus;
  occurred_at: string;
  reason_code: string | null;
  deadline_before: string | null;
  deadline_after: string;
  remaining_ms: number | null;
  escalation_level: number;
}

export type ClockRuleCode =
  | 'CLOCK_NOT_RUNNING'
  | 'CLOCK_NOT_PAUSED'
  | 'PAUSE_NOT_ALLOWED_BY_PUBLISHED_SLA'
  | 'CLOCK_DEADLINE_ELAPSED'
  | 'CLOCK_ALREADY_COMPLETED'
  | 'CLOCK_PAUSED_RESUME_REQUIRED'
  | 'COMPLETION_ANCHOR_MISMATCH'
  | 'START_ANCHOR_MISMATCH';

export class ClockRuleViolation extends Error {
  constructor(readonly rule: ClockRuleCode) {
    super(rule);
    this.name = 'ClockRuleViolation';
  }
}

export function startClock(
  policy: PolicySpec,
  calendar: CalendarSpec,
  nowMs: number,
): { state: ClockState; transition: ClockTransition } {
  const deadline = addDuration(
    calendar,
    policy.duration_basis,
    nowMs,
    policy.duration_minutes * MS_PER_MINUTE,
  );
  const at = new Date(nowMs).toISOString();
  const transition: ClockTransition = {
    operation: 'START',
    from_status: null,
    to_status: 'RUNNING',
    occurred_at: at,
    reason_code: null,
    deadline_before: null,
    deadline_after: new Date(deadline).toISOString(),
    remaining_ms: null,
    escalation_level: 0,
  };
  return { state: applyTransition(null, transition), transition };
}

export function decidePause(
  state: ClockState,
  policy: PolicySpec,
  calendar: CalendarSpec,
  nowMs: number,
  reasonCode: string,
): ClockTransition {
  if (state.status !== 'RUNNING') throw new ClockRuleViolation('CLOCK_NOT_RUNNING');
  if (!policy.allowed_pause_reason_codes.includes(reasonCode)) {
    throw new ClockRuleViolation('PAUSE_NOT_ALLOWED_BY_PUBLISHED_SLA');
  }
  const deadlineMs = Date.parse(state.deadline_at);
  if (nowMs >= deadlineMs) throw new ClockRuleViolation('CLOCK_DEADLINE_ELAPSED');
  return {
    operation: 'PAUSE',
    from_status: 'RUNNING',
    to_status: 'PAUSED',
    occurred_at: new Date(nowMs).toISOString(),
    reason_code: reasonCode,
    deadline_before: state.deadline_at,
    deadline_after: state.deadline_at,
    remaining_ms: durationBetween(calendar, policy.duration_basis, nowMs, deadlineMs),
    escalation_level: state.escalation_level,
  };
}

export function decideResume(
  state: ClockState,
  policy: PolicySpec,
  calendar: CalendarSpec,
  nowMs: number,
): ClockTransition {
  if (state.status !== 'PAUSED' || state.remaining_ms === null) {
    throw new ClockRuleViolation('CLOCK_NOT_PAUSED');
  }
  const deadline = addDuration(calendar, policy.duration_basis, nowMs, state.remaining_ms);
  return {
    operation: 'RESUME',
    from_status: 'PAUSED',
    to_status: 'RUNNING',
    occurred_at: new Date(nowMs).toISOString(),
    reason_code: state.pause_reason_code,
    deadline_before: state.deadline_at,
    deadline_after: new Date(deadline).toISOString(),
    remaining_ms: null,
    escalation_level: state.escalation_level,
  };
}

export function decideComplete(
  state: ClockState,
  policy: PolicySpec,
  nowMs: number,
  completionAnchor: string,
): ClockTransition {
  if (state.status === 'COMPLETED') throw new ClockRuleViolation('CLOCK_ALREADY_COMPLETED');
  if (state.status === 'PAUSED') throw new ClockRuleViolation('CLOCK_PAUSED_RESUME_REQUIRED');
  if (state.status !== 'RUNNING' && state.status !== 'BREACHED') {
    throw new ClockRuleViolation('CLOCK_NOT_RUNNING');
  }
  if (completionAnchor !== policy.completion_anchor) {
    throw new ClockRuleViolation('COMPLETION_ANCHOR_MISMATCH');
  }
  return {
    operation: 'COMPLETE',
    from_status: state.status,
    to_status: 'COMPLETED',
    occurred_at: new Date(nowMs).toISOString(),
    reason_code: null,
    deadline_before: state.deadline_at,
    deadline_after: state.deadline_at,
    remaining_ms: null,
    escalation_level: state.escalation_level,
  };
}

/**
 * Evaluates warning, breach and escalation due at `nowMs`. Returns transitions in the order they
 * must be applied; an empty array means nothing is due. A paused or completed clock never
 * breaches or escalates.
 */
export function evaluateClock(
  state: ClockState,
  policy: PolicySpec,
  calendar: CalendarSpec,
  nowMs: number,
): ClockTransition[] {
  const out: ClockTransition[] = [];
  let current = state;
  const push = (t: ClockTransition): void => {
    out.push(t);
    current = applyTransition(current, t);
  };
  const at = new Date(nowMs).toISOString();
  const deadlineMs = Date.parse(current.deadline_at);

  if (current.status === 'RUNNING') {
    if (nowMs < deadlineMs) {
      const warn = policy.warning_before_minutes;
      if (
        warn !== null &&
        current.warning_emitted_at === null &&
        durationBetween(calendar, policy.duration_basis, nowMs, deadlineMs) <= warn * MS_PER_MINUTE
      ) {
        push({
          operation: 'WARN',
          from_status: 'RUNNING',
          to_status: 'RUNNING',
          occurred_at: at,
          reason_code: null,
          deadline_before: current.deadline_at,
          deadline_after: current.deadline_at,
          remaining_ms: null,
          escalation_level: current.escalation_level,
        });
      }
      return out;
    }
    push({
      operation: 'BREACH',
      from_status: 'RUNNING',
      to_status: 'BREACHED',
      occurred_at: at,
      reason_code: null,
      deadline_before: current.deadline_at,
      deadline_after: current.deadline_at,
      remaining_ms: null,
      escalation_level: current.escalation_level,
    });
  }

  if (current.status === 'BREACHED') {
    const overdue = durationBetween(calendar, policy.duration_basis, deadlineMs, nowMs);
    const steps = [...policy.escalation_schedule].sort((a, b) => a.level - b.level);
    for (const step of steps) {
      if (step.level <= current.escalation_level) continue;
      if (overdue < step.after_deadline_minutes * MS_PER_MINUTE) break;
      push({
        operation: 'ESCALATE',
        from_status: 'BREACHED',
        to_status: 'BREACHED',
        occurred_at: at,
        reason_code: step.action_code,
        deadline_before: current.deadline_at,
        deadline_after: current.deadline_at,
        remaining_ms: null,
        escalation_level: step.level,
      });
    }
  }
  return out;
}

export function applyTransition(state: ClockState | null, t: ClockTransition): ClockState {
  if (t.operation === 'START') {
    return {
      status: 'RUNNING',
      started_at: t.occurred_at,
      deadline_at: t.deadline_after,
      remaining_ms: null,
      paused_at: null,
      pause_reason_code: null,
      pause_count: 0,
      resumed_at: null,
      completed_at: null,
      breach_at: null,
      warning_emitted_at: null,
      escalation_level: 0,
    };
  }
  if (state === null) throw new Error('clock history must begin with START');
  const next: ClockState = { ...state, status: t.to_status, escalation_level: t.escalation_level };
  switch (t.operation) {
    case 'PAUSE':
      next.paused_at = t.occurred_at;
      next.pause_reason_code = t.reason_code;
      next.remaining_ms = t.remaining_ms;
      next.pause_count = state.pause_count + 1;
      break;
    case 'RESUME':
      next.paused_at = null;
      next.pause_reason_code = null;
      next.remaining_ms = null;
      next.resumed_at = t.occurred_at;
      next.deadline_at = t.deadline_after;
      break;
    case 'COMPLETE':
      next.completed_at = t.occurred_at;
      break;
    case 'WARN':
      next.warning_emitted_at = t.occurred_at;
      break;
    case 'BREACH':
      next.breach_at = state.deadline_at;
      break;
    case 'ESCALATE':
      break;
  }
  return next;
}

export function replayClock(history: readonly ClockTransition[]): ClockState {
  let state: ClockState | null = null;
  for (const t of history) state = applyTransition(state, t);
  if (state === null) throw new Error('empty clock history');
  return state;
}

/**
 * Recomputes every deadline in a history from the pinned policy and calendar version and returns
 * the discrepancies. An empty array proves the stored deadlines are reproducible (deterministic
 * replay) and were not hand-edited.
 */
export function verifyClockHistory(
  policy: PolicySpec,
  calendar: CalendarSpec,
  history: readonly ClockTransition[],
): string[] {
  const problems: string[] = [];
  let state: ClockState | null = null;
  history.forEach((t, i) => {
    const at = Date.parse(t.occurred_at);
    if (state === null && t.operation !== 'START') {
      if (i === 0) problems.push('FIRST_EVENT_NOT_START');
      return;
    }
    if (i === 0) {
      if (t.operation !== 'START') problems.push('FIRST_EVENT_NOT_START');
    } else if (state === null || t.from_status !== state.status) {
      problems.push(`SEQ_${i + 1}_FROM_STATUS_MISMATCH`);
    }
    if (t.operation === 'START') {
      const expected = addDuration(
        calendar,
        policy.duration_basis,
        at,
        policy.duration_minutes * MS_PER_MINUTE,
      );
      if (Date.parse(t.deadline_after) !== expected) problems.push(`SEQ_${i + 1}_DEADLINE_DRIFT`);
    } else if (state !== null && t.operation === 'PAUSE') {
      const expected = durationBetween(
        calendar,
        policy.duration_basis,
        at,
        Date.parse(state.deadline_at),
      );
      if (t.remaining_ms !== expected) problems.push(`SEQ_${i + 1}_REMAINING_DRIFT`);
    } else if (state !== null && t.operation === 'RESUME' && state.remaining_ms !== null) {
      const expected = addDuration(calendar, policy.duration_basis, at, state.remaining_ms);
      if (Date.parse(t.deadline_after) !== expected) problems.push(`SEQ_${i + 1}_DEADLINE_DRIFT`);
    } else if (state !== null && t.operation !== 'RESUME') {
      if (t.deadline_after !== state.deadline_at) problems.push(`SEQ_${i + 1}_DEADLINE_EDITED`);
    }
    state = applyTransition(state, t);
  });
  return problems;
}
