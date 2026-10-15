/** FROZEN SF-CON-APPOINTMENT markers and lifecycle. */

export const CONTRACT_ID = 'SF-CON-APPOINTMENT';
export const APPOINTMENT_RESOURCE_TYPE = 'Appointment';
export const SLOT_RESOURCE_TYPE = 'AppointmentSlot';
export const TYPE_RESOURCE_TYPE = 'AppointmentType';

export const LIFECYCLE_STATUSES = [
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const ACTIVE_STATUSES: ReadonlySet<LifecycleStatus> = new Set(['BOOKED', 'RESCHEDULED']);
export const TERMINAL_STATUSES: ReadonlySet<LifecycleStatus> = new Set([
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
]);

export const CAPACITY_ATOMIC = true as const;
export const NOTIFICATION_FAILURE_INVALIDATES_BOOKING = false as const;
export const INVENTED_STATUTORY_POLICY_FORBIDDEN = true as const;

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface AppointmentTypeRecord {
  tenant_id: string;
  appointment_type_id: string;
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  last_correlation_id: string;
}

export interface SlotRecord {
  tenant_id: string;
  slot_id: string;
  slot_ref: string;
  appointment_type_id: string;
  capacity: number;
  booked_count: number;
  opens_at: string;
  closes_at: string;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface AppointmentRecord {
  tenant_id: string;
  appointment_id: string;
  appointment_type_id: string;
  appointment_type_ref: string;
  slot_id: string;
  slot_ref: string;
  resource_calendar_ref: string | null;
  lifecycle_status: LifecycleStatus;
  appointment_version: number;
  participant_ref: string | null;
  notification_status: NotificationStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
  last_correlation_id: string;
}

export interface AppointmentEventLogRow {
  tenant_id: string;
  event_log_id: string;
  appointment_id: string;
  from_status: LifecycleStatus | null;
  to_status: LifecycleStatus;
  from_slot_ref: string | null;
  to_slot_ref: string;
  appointment_version: number;
  actor_id: string;
  correlation_id: string;
  occurred_at: string;
}

const isAlnum = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** Opaque owner-supplied ref: 1..128 printable chars, not a free-form statute calendar. */
export function isOpaqueRef(value: string, max = 128): boolean {
  if (value.length < 1 || value.length > max) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 33 || c > 126) return false;
  }
  return true;
}

/**
 * Refuse strings that look like invented hearing/inspection statutory calendars
 * (e.g. "Code of Civil Procedure Sch.I", "CrPC hearing calendar"). Owner metadata
 * refs like `meta:appointment-type:hearing-slot` remain allowed.
 */
const STATUTORY_CALENDAR_MARKERS = [
  'code of civil procedure',
  'crpc ',
  'cpc schedule',
  'statutory hearing calendar',
  'inspection statute calendar',
  'hearing calendar act',
];

export function looksLikeInventedStatutoryCalendar(value: string): boolean {
  const lower = value.toLowerCase();
  return STATUTORY_CALENDAR_MARKERS.some((m) => lower.includes(m));
}

export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return typeof value === 'string' && (LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function remainingCapacity(slot: Pick<SlotRecord, 'capacity' | 'booked_count'>): number {
  return slot.capacity - slot.booked_count;
}

export function canBook(slot: Pick<SlotRecord, 'capacity' | 'booked_count'>): boolean {
  return remainingCapacity(slot) > 0;
}

export function assertCapacityAtomic(): typeof CAPACITY_ATOMIC {
  return CAPACITY_ATOMIC;
}

/** Allowed lifecycle transitions for INT-014 booking commands. */
export function canTransition(
  from: LifecycleStatus,
  to: LifecycleStatus,
): { allowed: boolean; reason?: string } {
  if (from === to) return { allowed: false, reason: 'SAME_STATE' };
  if (TERMINAL_STATUSES.has(from)) return { allowed: false, reason: 'TERMINAL_STATE' };
  if (to === 'RESCHEDULED' && ACTIVE_STATUSES.has(from)) return { allowed: true };
  if (to === 'CANCELLED' && ACTIVE_STATUSES.has(from)) return { allowed: true };
  if (to === 'COMPLETED' && ACTIVE_STATUSES.has(from)) return { allowed: true };
  if (to === 'NO_SHOW' && ACTIVE_STATUSES.has(from)) return { allowed: true };
  return { allowed: false, reason: 'TRANSITION_NOT_PERMITTED' };
}

/** SF-CON-APPOINTMENT projection (constants pinned). */
export function toContract(
  row: AppointmentRecord,
  idempotencyKey: string,
  correlationId?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    idempotency_key: idempotencyKey,
    invented_statutory_policy_forbidden: INVENTED_STATUTORY_POLICY_FORBIDDEN,
    appointment_id: row.appointment_id,
    appointment_type_ref: row.appointment_type_ref,
    lifecycle_status: row.lifecycle_status,
    slot_ref: row.slot_ref,
    capacity_atomic: CAPACITY_ATOMIC,
    notification_failure_invalidates_booking: NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
  };
  if (row.resource_calendar_ref !== null) {
    out['resource_calendar_ref'] = row.resource_calendar_ref;
  }
  if (correlationId) out['correlation_id'] = correlationId;
  return out;
}

export function appointmentView(
  row: AppointmentRecord,
  idempotencyKey = 'response-view',
): Record<string, unknown> {
  return {
    appointment: toContract(row, idempotencyKey, row.last_correlation_id),
    appointment_version: row.appointment_version,
    notification_status: row.notification_status,
    participant_ref: row.participant_ref,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function slotView(row: SlotRecord): Record<string, unknown> {
  return {
    slot_id: row.slot_id,
    slot_ref: row.slot_ref,
    appointment_type_id: row.appointment_type_id,
    capacity: row.capacity,
    booked_count: row.booked_count,
    remaining: remainingCapacity(row),
    capacity_atomic: CAPACITY_ATOMIC,
    opens_at: row.opens_at,
    closes_at: row.closes_at,
  };
}

/** Linear start check for opaque refs that also begin with an alnum (common metadata shape). */
export function isMetadataRef(value: string): boolean {
  if (!isOpaqueRef(value)) return false;
  return isAlnum(value.charCodeAt(0));
}
