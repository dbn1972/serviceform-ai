import type { ClockState, ClockTransition, EscalationStep } from '../domain/clock.js';
import type { DurationBasis } from '../domain/calendar.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';

export interface CalendarRow {
  calendar_id: string;
  calendar_code: string;
  version_no: number;
  utc_offset_minutes: number;
  working_weekdays: number[];
  window_start_minute: number;
  window_end_minute: number;
  holidays: string[];
  effective_from: string;
}

export interface PolicyRow {
  policy_id: string;
  policy_code: string;
  version_no: number;
  status: 'PUBLISHED' | 'RETIRED';
  publication_ref: string;
  start_anchor: string;
  completion_anchor: string;
  calendar_id: string;
  duration_basis: DurationBasis;
  duration_minutes: number;
  warning_before_minutes: number | null;
  allowed_pause_reason_codes: string[];
  escalation_schedule: EscalationStep[];
}

export interface ClockRow extends ClockState {
  tenant_id: string;
  clock_id: string;
  cell_id: string;
  application_id: string;
  stage_code: string;
  policy_id: string;
  calendar_id: string;
  start_anchor: string;
  completion_anchor: string;
  anchor_event_ref: string | null;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryRow extends ClockTransition {
  clock_id: string;
  sequence_no: number;
  actor_type: ActorType;
  actor_id: string;
  correlation_id: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface SlaTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;

  insertCalendar(row: CalendarRow & { created_by: string }): Promise<void>;
  getCalendar(id: string): Promise<CalendarRow | null>;
  latestCalendarVersion(code: string): Promise<number>;

  insertPolicy(row: PolicyRow & { created_by: string }): Promise<void>;
  getPolicy(id: string): Promise<PolicyRow | null>;
  latestPolicyVersion(code: string): Promise<number>;
  retirePolicy(id: string, now: Date): Promise<void>;

  insertClock(row: ClockRow): Promise<void>;
  getClock(id: string): Promise<ClockRow | null>;
  lockClock(id: string): Promise<ClockRow | null>;
  findClock(applicationId: string, stageCode: string): Promise<ClockRow | null>;
  clocksForApplication(applicationId: string): Promise<ClockRow[]>;
  updateClock(id: string, state: ClockState, expectedVersion: number, now: Date): Promise<void>;

  appendHistory(row: HistoryRow): Promise<void>;
  listHistory(clockId: string): Promise<HistoryRow[]>;

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface SlaRepository {
  withTx<T>(ctx: RequestContext, fn: (tx: SlaTx) => Promise<T>): Promise<T>;
  inTransaction(): boolean;
}
