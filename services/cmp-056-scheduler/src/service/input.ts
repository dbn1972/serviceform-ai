import { ATTENDANCE_OUTCOMES, type AttendanceOutcome } from '../domain/appointment.js';
import { isErrorCode, isOpaqueRef } from '../domain/charset.js';
import type { NotificationResult } from '../domain/notification.js';
import { MAX_SLOT_CAPACITY } from '../domain/slot.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp056Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'booked_at',
  'updated_at',
  'recorded_at',
  'created_at',
  'as_of',
]);

/**
 * Fields a client could use to dictate booking state or contract invariants. Identity, tenant,
 * lifecycle, capacity accounting and the frozen SF-CON-APPOINTMENT constants are server-derived.
 */
export const CLIENT_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  'tenant_id',
  'appointment_id',
  'slot_id',
  'lifecycle_status',
  'status',
  'version',
  'booked_by',
  'booked_count',
  'remaining_capacity',
  'idempotency_key',
  'correlation_id',
  'contract_id',
  'contract_status',
  'freeze_status',
  'capacity_atomic',
  'notification_failure_invalidates_booking',
  'invented_statutory_policy_forbidden',
  'booking_invalidated',
  'overbook',
  'force',
]);

export interface SlotInput {
  slot_ref: string;
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  jurisdiction_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
}

export interface BookInput {
  slot_ref: string;
  application_id: string | null;
}

export interface RescheduleInput {
  slot_ref: string;
}

export interface AttendanceInput {
  outcome: AttendanceOutcome;
}

export interface NotificationInput {
  outcome: NotificationResult;
  outcome_ref: string;
  failure_code: string | null;
}

export interface SlotQuery {
  appointment_type_ref: string | null;
  resource_calendar_ref: string | null;
  from: string | null;
  to: string | null;
  limit: number;
}

export const DEFAULT_SLOT_LIMIT = 50;
export const MAX_SLOT_LIMIT = 200;

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp056Error('SF-SYS-003', detail(code, pointer));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad('/', 'BODY_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp056Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function onlyKeys(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  for (const key of Object.keys(rec)) {
    if (CLIENT_AUTHORITY_KEYS.has(key)) bad(`/${key}`, 'CLIENT_AUTHORITY_FORBIDDEN');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** RFC 3339 instant with an explicit offset; returned normalised to UTC. */
export function parseInstant(value: unknown, pointer: string): string {
  if (typeof value !== 'string' || value.length > 40 || !INSTANT.test(value)) {
    bad(pointer, 'INSTANT_REQUIRED');
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) bad(pointer, 'INSTANT_REQUIRED');
  return new Date(ms).toISOString();
}

function ref(value: unknown, pointer: string): string {
  if (!isOpaqueRef(value, 1, 128)) bad(pointer, 'REF_INVALID');
  return value;
}

function optionalRef(value: unknown, pointer: string): string | null {
  return value === undefined || value === null ? null : ref(value, pointer);
}

function optionalUuid(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}

export function validateSlotInput(body: unknown): SlotInput {
  const rec = asRecord(body);
  onlyKeys(rec, [
    'slot_ref',
    'appointment_type_ref',
    'resource_calendar_ref',
    'jurisdiction_id',
    'starts_at',
    'ends_at',
    'capacity',
  ]);
  const startsAt = parseInstant(rec['starts_at'], '/starts_at');
  const endsAt = parseInstant(rec['ends_at'], '/ends_at');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) bad('/ends_at', 'SLOT_WINDOW_INVALID');
  const capacity = rec['capacity'];
  if (
    typeof capacity !== 'number' ||
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > MAX_SLOT_CAPACITY
  ) {
    bad('/capacity', 'CAPACITY_INVALID');
  }
  return {
    slot_ref: ref(rec['slot_ref'], '/slot_ref'),
    appointment_type_ref: ref(rec['appointment_type_ref'], '/appointment_type_ref'),
    resource_calendar_ref: optionalRef(rec['resource_calendar_ref'], '/resource_calendar_ref'),
    jurisdiction_id: optionalUuid(rec['jurisdiction_id'], '/jurisdiction_id'),
    starts_at: startsAt,
    ends_at: endsAt,
    capacity,
  };
}

export function validateBookInput(body: unknown): BookInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['slot_ref', 'application_id']);
  return {
    slot_ref: ref(rec['slot_ref'], '/slot_ref'),
    application_id: optionalUuid(rec['application_id'], '/application_id'),
  };
}

export function validateRescheduleInput(body: unknown): RescheduleInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['slot_ref']);
  return { slot_ref: ref(rec['slot_ref'], '/slot_ref') };
}

export function validateAttendanceInput(body: unknown): AttendanceInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['outcome']);
  const outcome = rec['outcome'];
  if (
    typeof outcome !== 'string' ||
    !(ATTENDANCE_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    bad('/outcome', 'OUTCOME_INVALID');
  }
  return { outcome: outcome as AttendanceOutcome };
}

export function validateNotificationInput(body: unknown): NotificationInput {
  const rec = asRecord(body);
  onlyKeys(rec, ['outcome', 'outcome_ref', 'failure_code']);
  const outcome = rec['outcome'];
  if (outcome !== 'SUCCEEDED' && outcome !== 'FAILED') bad('/outcome', 'OUTCOME_INVALID');
  const outcomeRef = ref(rec['outcome_ref'], '/outcome_ref');
  const failure = rec['failure_code'];
  if (outcome === 'FAILED') {
    if (!isErrorCode(failure)) bad('/failure_code', 'FAILURE_CODE_REQUIRED');
  } else if (failure !== undefined) {
    bad('/failure_code', 'FAILURE_CODE_FORBIDDEN');
  }
  return {
    outcome,
    outcome_ref: outcomeRef,
    failure_code: outcome === 'FAILED' ? (failure as string) : null,
  };
}

export function validateEmptyInput(body: unknown): void {
  const rec = asRecord(body);
  assertNoClientTime(rec, 'body');
  if (Object.keys(rec).length > 0) bad(`/${Object.keys(rec)[0] as string}`, 'UNKNOWN_FIELD');
}

function single(value: string | string[] | undefined, pointer: string): string | undefined {
  if (Array.isArray(value)) bad(pointer, 'SINGLE_VALUE_REQUIRED');
  return value;
}

export function validateSlotQuery(
  query: Readonly<Record<string, string | string[] | undefined>>,
): SlotQuery {
  const allowed = ['appointment_type_ref', 'resource_calendar_ref', 'from', 'to', 'limit'];
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) bad(`/query/${key}`, 'UNKNOWN_FIELD');
  }
  const type = single(query['appointment_type_ref'], '/query/appointment_type_ref');
  const calendar = single(query['resource_calendar_ref'], '/query/resource_calendar_ref');
  const from = single(query['from'], '/query/from');
  const to = single(query['to'], '/query/to');
  const limitRaw = single(query['limit'], '/query/limit');
  let limit = DEFAULT_SLOT_LIMIT;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!/^\d{1,3}$/.test(limitRaw) || limit < 1 || limit > MAX_SLOT_LIMIT) {
      bad('/query/limit', 'LIMIT_INVALID');
    }
  }
  const out: SlotQuery = {
    appointment_type_ref:
      type === undefined ? null : ref(type, '/query/appointment_type_ref'),
    resource_calendar_ref:
      calendar === undefined ? null : ref(calendar, '/query/resource_calendar_ref'),
    from: from === undefined ? null : parseInstant(from, '/query/from'),
    to: to === undefined ? null : parseInstant(to, '/query/to'),
    limit,
  };
  if (out.from !== null && out.to !== null && Date.parse(out.to) <= Date.parse(out.from)) {
    bad('/query/to', 'RANGE_INVALID');
  }
  return out;
}
