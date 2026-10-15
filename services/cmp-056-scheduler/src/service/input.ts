import {
  isMetadataRef,
  looksLikeInventedStatutoryCalendar,
} from '../domain/appointment.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp056Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'updated_at',
]);

const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'appointment_id',
  'appointment_version',
  'correlation_id',
  'lifecycle_status',
  'capacity_atomic',
  'notification_failure_invalidates_booking',
  'invented_statutory_policy_forbidden',
  'notification_status',
]);

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp056Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown): Record<string, unknown> {
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

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp056Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

function requireRef(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string') bad(`/${key}`, 'INVALID_REF');
  // Refuse invented statutory calendars before shape checks so statute-looking free text
  // (spaces, etc.) is rejected with the governance code, not a generic INVALID_REF.
  if (looksLikeInventedStatutoryCalendar(v)) {
    bad(`/${key}`, 'INVENTED_STATUTORY_CALENDAR_FORBIDDEN');
  }
  if (!isMetadataRef(v)) bad(`/${key}`, 'INVALID_REF');
  return v;
}

function optionalRef(rec: Record<string, unknown>, key: string): string | null {
  if (!(key in rec) || rec[key] === null) return null;
  return requireRef(rec, key);
}

export function validateEmptyInput(body: unknown): void {
  commonChecks(asRecord(body), []);
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) {
    throw new Cmp056Error('SF-SYS-003', detail('INVALID_UUID', pointer));
  }
  return value;
}

export interface RegisterTypeInput {
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
}

export function validateRegisterType(body: unknown): RegisterTypeInput {
  const rec = asRecord(body);
  commonChecks(rec, ['appointment_type_ref', 'resource_calendar_ref']);
  return {
    appointment_type_ref: requireRef(rec, 'appointment_type_ref'),
    resource_calendar_ref: optionalRef(rec, 'resource_calendar_ref'),
  };
}

export interface PublishSlotInput {
  appointment_type_id: string;
  slot_ref: string;
  capacity: number;
  opens_at: string;
  closes_at: string;
}

export function validatePublishSlot(body: unknown): PublishSlotInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'appointment_type_id',
    'slot_ref',
    'capacity',
    'opens_at',
    'closes_at',
  ]);
  const typeId = rec['appointment_type_id'];
  if (typeof typeId !== 'string' || !isUuid(typeId)) bad('/appointment_type_id', 'INVALID_UUID');
  const capacity = rec['capacity'];
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
    bad('/capacity', 'INVALID_CAPACITY');
  }
  const opens = rec['opens_at'];
  const closes = rec['closes_at'];
  if (typeof opens !== 'string' || Number.isNaN(Date.parse(opens))) bad('/opens_at', 'INVALID_TIME');
  if (typeof closes !== 'string' || Number.isNaN(Date.parse(closes))) bad('/closes_at', 'INVALID_TIME');
  if (Date.parse(closes) <= Date.parse(opens)) bad('/closes_at', 'CLOSES_BEFORE_OPENS');
  return {
    appointment_type_id: typeId,
    slot_ref: requireRef(rec, 'slot_ref'),
    capacity,
    opens_at: opens,
    closes_at: closes,
  };
}

export interface BookAppointmentInput {
  slot_ref: string;
  participant_ref: string | null;
}

export function validateBookAppointment(body: unknown): BookAppointmentInput {
  const rec = asRecord(body);
  commonChecks(rec, ['slot_ref', 'participant_ref']);
  return {
    slot_ref: requireRef(rec, 'slot_ref'),
    participant_ref: optionalRef(rec, 'participant_ref'),
  };
}

export interface RescheduleInput {
  slot_ref: string;
  expected_version: number;
}

export function validateReschedule(body: unknown): RescheduleInput {
  const rec = asRecord(body);
  commonChecks(rec, ['slot_ref', 'expected_version']);
  const ver = rec['expected_version'];
  if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 1) {
    bad('/expected_version', 'INVALID_VERSION');
  }
  return { slot_ref: requireRef(rec, 'slot_ref'), expected_version: ver };
}

export interface VersionedActionInput {
  expected_version: number;
}

export function validateVersionedAction(body: unknown): VersionedActionInput {
  const rec = asRecord(body);
  commonChecks(rec, ['expected_version']);
  const ver = rec['expected_version'];
  if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 1) {
    bad('/expected_version', 'INVALID_VERSION');
  }
  return { expected_version: ver };
}
