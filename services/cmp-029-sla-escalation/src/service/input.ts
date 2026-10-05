import { isIsoDate } from '../domain/calendar.js';
import type { DurationBasis } from '../domain/calendar.js';
import type { EscalationStep } from '../domain/clock.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp029Error, detail } from '../errors.js';

export const START_ANCHORS = [
  'APPLICATION_RECEIVED',
  'PAYMENT_CONFIRMED',
  'SCRUTINY_STARTED',
  'DEFICIENCY_CLOSED',
  'PUBLISHED_POLICY_ANCHOR',
] as const;
export const COMPLETION_ANCHORS = [
  'DECISION_RECORDED',
  'CREDENTIAL_ISSUED',
  'CASE_CLOSED',
  'PUBLISHED_POLICY_ANCHOR',
] as const;

const ACTION_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Body/query members that would let a caller assert time. The service clock is the only time
 * source (Constitution #16, SF-CON-SLA-CLOCK); these are refused rather than ignored.
 */
export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'started_at',
  'paused_at',
  'resumed_at',
  'completed_at',
  'breach_at',
  'deadline',
  'deadline_at',
  'effective_from',
  'as_of',
]);

export interface CalendarInput {
  calendar_code: string;
  utc_offset_minutes: number;
  working_weekdays: number[];
  window_start_minute: number;
  window_end_minute: number;
  holidays: string[];
}

export interface PolicyInput {
  policy_code: string;
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

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp029Error('SF-SYS-003', detail(code, pointer));
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp029Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_MUST_BE_OBJECT');
  return value as Record<string, unknown>;
}

function allowOnly(obj: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(obj, 'body');
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_PROPERTY');
  }
}

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') bad(`/${key}`, 'STRING_REQUIRED');
  return v as string;
}

function code(obj: Record<string, unknown>, key: string): string {
  const v = str(obj, key);
  if (!ACTION_CODE.test(v)) bad(`/${key}`, 'CODE_PATTERN');
  return v;
}

function uuid(obj: Record<string, unknown>, key: string): string {
  const v = str(obj, key);
  if (!isUuid(v)) bad(`/${key}`, 'UUID_REQUIRED');
  return v;
}

function int(obj: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    bad(`/${key}`, 'INTEGER_RANGE');
  return v as number;
}

function oneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = str(obj, key);
  if (!(allowed as readonly string[]).includes(v)) bad(`/${key}`, 'ENUM');
  return v as T;
}

export function validateCalendarInput(input: unknown): CalendarInput {
  const obj = asRecord(input);
  allowOnly(obj, [
    'calendar_code',
    'utc_offset_minutes',
    'working_weekdays',
    'window_start_minute',
    'window_end_minute',
    'holidays',
  ]);
  const weekdays = obj['working_weekdays'];
  if (!Array.isArray(weekdays) || weekdays.length < 1 || weekdays.length > 7) {
    bad('/working_weekdays', 'WORKING_WEEKDAYS_INVALID');
  }
  const days = weekdays as unknown[];
  if (!days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 7)) {
    bad('/working_weekdays', 'WORKING_WEEKDAYS_INVALID');
  }
  if (new Set(days).size !== days.length) bad('/working_weekdays', 'WORKING_WEEKDAYS_INVALID');
  const holidays = obj['holidays'] ?? [];
  if (!Array.isArray(holidays) || holidays.length > 3660) bad('/holidays', 'HOLIDAYS_INVALID');
  const hs = holidays as unknown[];
  if (!hs.every((h) => typeof h === 'string' && isIsoDate(h))) bad('/holidays', 'HOLIDAYS_INVALID');
  const start = int(obj, 'window_start_minute', 0, 1439);
  const end = int(obj, 'window_end_minute', 1, 1440);
  if (start >= end) bad('/window_end_minute', 'WORKING_WINDOW_INVALID');
  return {
    calendar_code: code(obj, 'calendar_code'),
    utc_offset_minutes: int(obj, 'utc_offset_minutes', -720, 840),
    working_weekdays: days as number[],
    window_start_minute: start,
    window_end_minute: end,
    holidays: hs as string[],
  };
}

export function validatePolicyInput(input: unknown): PolicyInput {
  const obj = asRecord(input);
  allowOnly(obj, [
    'policy_code',
    'publication_ref',
    'start_anchor',
    'completion_anchor',
    'calendar_id',
    'duration_basis',
    'duration_minutes',
    'warning_before_minutes',
    'allowed_pause_reason_codes',
    'escalation_schedule',
  ]);
  const publicationRef = str(obj, 'publication_ref');
  if (publicationRef.length < 3 || publicationRef.length > 200) bad('/publication_ref', 'LENGTH');
  const durationMinutes = int(obj, 'duration_minutes', 1, 2_000_000);
  let warning: number | null = null;
  if (obj['warning_before_minutes'] !== undefined && obj['warning_before_minutes'] !== null) {
    warning = int(obj, 'warning_before_minutes', 1, 2_000_000);
    if (warning >= durationMinutes) bad('/warning_before_minutes', 'WARNING_NOT_BEFORE_DEADLINE');
  }
  const reasonsRaw = obj['allowed_pause_reason_codes'] ?? [];
  if (!Array.isArray(reasonsRaw) || reasonsRaw.length > 32)
    bad('/allowed_pause_reason_codes', 'LIST_INVALID');
  const reasons = reasonsRaw as unknown[];
  if (
    !reasons.every((r) => typeof r === 'string' && ACTION_CODE.test(r)) ||
    new Set(reasons).size !== reasons.length
  ) {
    bad('/allowed_pause_reason_codes', 'CODE_PATTERN');
  }
  const scheduleRaw = obj['escalation_schedule'] ?? [];
  if (!Array.isArray(scheduleRaw) || scheduleRaw.length > 10)
    bad('/escalation_schedule', 'LIST_INVALID');
  const schedule: EscalationStep[] = (scheduleRaw as unknown[]).map((entry, i) => {
    const step = asRecord(entry);
    allowOnly(step, ['level', 'after_deadline_minutes', 'action_code']);
    return {
      level: int(step, 'level', 1, 10),
      after_deadline_minutes: int(step, 'after_deadline_minutes', 0, 2_000_000),
      action_code: ((): string => {
        try {
          return code(step, 'action_code');
        } catch {
          return bad(`/escalation_schedule/${i}/action_code`, 'CODE_PATTERN');
        }
      })(),
    };
  });
  schedule.forEach((step, i) => {
    const prev = schedule[i - 1];
    if (step.level !== i + 1) bad(`/escalation_schedule/${i}/level`, 'LEVELS_MUST_BE_CONSECUTIVE');
    if (prev && step.after_deadline_minutes < prev.after_deadline_minutes) {
      bad(`/escalation_schedule/${i}/after_deadline_minutes`, 'OFFSETS_MUST_NOT_DECREASE');
    }
  });
  return {
    policy_code: code(obj, 'policy_code'),
    publication_ref: publicationRef,
    start_anchor: oneOf(obj, 'start_anchor', START_ANCHORS),
    completion_anchor: oneOf(obj, 'completion_anchor', COMPLETION_ANCHORS),
    calendar_id: uuid(obj, 'calendar_id'),
    duration_basis: oneOf(obj, 'duration_basis', ['WORKING_MINUTES', 'CALENDAR_MINUTES'] as const),
    duration_minutes: durationMinutes,
    warning_before_minutes: warning,
    allowed_pause_reason_codes: reasons as string[],
    escalation_schedule: schedule,
  };
}

export interface ParsedStart {
  application_id: string;
  policy_id: string;
  stage_code: string;
  start_anchor: string;
  anchor_event_ref?: string;
}

export function validateStartInput(input: unknown): ParsedStart {
  const obj = asRecord(input);
  allowOnly(obj, ['application_id', 'policy_id', 'stage_code', 'start_anchor', 'anchor_event_ref']);
  const out: ParsedStart = {
    application_id: uuid(obj, 'application_id'),
    policy_id: uuid(obj, 'policy_id'),
    stage_code: obj['stage_code'] === undefined ? 'OVERALL' : code(obj, 'stage_code'),
    start_anchor: oneOf(obj, 'start_anchor', START_ANCHORS),
  };
  if (obj['anchor_event_ref'] !== undefined) out.anchor_event_ref = uuid(obj, 'anchor_event_ref');
  return out;
}

export function validatePauseInput(input: unknown): { reason_code: string } {
  const obj = asRecord(input);
  allowOnly(obj, ['reason_code']);
  return { reason_code: code(obj, 'reason_code') };
}

export function validateCompleteInput(input: unknown): { completion_anchor: string } {
  const obj = asRecord(input);
  allowOnly(obj, ['completion_anchor']);
  return { completion_anchor: oneOf(obj, 'completion_anchor', COMPLETION_ANCHORS) };
}

export function validateEmptyInput(input: unknown): Record<string, never> {
  allowOnly(asRecord(input), []);
  return {};
}
