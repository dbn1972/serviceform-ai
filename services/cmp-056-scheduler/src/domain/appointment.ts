import { Cmp056Error, detail } from '../errors.js';
import type { ActorType } from '../types.js';

export const LIFECYCLE_STATUSES = [
  'BOOKED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** Every status except CANCELLED keeps its slot seat; COMPLETED/NO_SHOW consumed the seat. */
export const SEAT_HOLDING: ReadonlySet<LifecycleStatus> = new Set([
  'BOOKED',
  'RESCHEDULED',
  'COMPLETED',
  'NO_SHOW',
]);

const TRANSITIONS: Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>> = {
  BOOKED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  RESCHEDULED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

export function isTerminal(status: LifecycleStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LifecycleStatus, to: LifecycleStatus): void {
  if (!canTransition(from, to)) {
    throw new Cmp056Error('SF-APP-001', detail('INVALID_APPOINTMENT_TRANSITION'));
  }
}

export interface AppointmentRow {
  tenant_id: string;
  appointment_id: string;
  appointment_type_ref: string;
  slot_id: string;
  slot_ref: string;
  resource_calendar_ref: string | null;
  application_id: string | null;
  lifecycle_status: LifecycleStatus;
  idempotency_key: string;
  version: number;
  correlation_id: string;
  actor_type: ActorType;
  booked_by: string;
  booked_at: string;
  updated_at: string;
}

export interface AppointmentHistoryRow {
  tenant_id: string;
  appointment_event_id: string;
  appointment_id: string;
  version: number;
  from_status: LifecycleStatus | null;
  to_status: LifecycleStatus;
  slot_ref: string;
  previous_slot_ref: string | null;
  actor_type: ActorType;
  actor_id: string;
  correlation_id: string;
  recorded_at: string;
}

/** SF-CON-APPOINTMENT v1 (FROZEN). Exactly the frozen properties; nothing else is emitted. */
export interface AppointmentView {
  contract_id: 'SF-CON-APPOINTMENT';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  idempotency_key: string;
  invented_statutory_policy_forbidden: true;
  correlation_id: string;
  appointment_id: string;
  appointment_type_ref: string;
  lifecycle_status: LifecycleStatus;
  slot_ref: string;
  resource_calendar_ref: string | null;
  capacity_atomic: true;
  notification_failure_invalidates_booking: false;
}

export function appointmentView(row: AppointmentRow): AppointmentView {
  return {
    contract_id: 'SF-CON-APPOINTMENT',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    idempotency_key: row.idempotency_key,
    invented_statutory_policy_forbidden: true,
    correlation_id: row.correlation_id,
    appointment_id: row.appointment_id,
    appointment_type_ref: row.appointment_type_ref,
    lifecycle_status: row.lifecycle_status,
    slot_ref: row.slot_ref,
    resource_calendar_ref: row.resource_calendar_ref,
    capacity_atomic: true,
    notification_failure_invalidates_booking: false,
  };
}

export const ATTENDANCE_OUTCOMES = ['COMPLETED', 'NO_SHOW'] as const;
export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

export const EVENT_FOR_STATUS: Readonly<Record<LifecycleStatus, string>> = {
  BOOKED: 'AppointmentBooked',
  RESCHEDULED: 'AppointmentRescheduled',
  CANCELLED: 'AppointmentCancelled',
  COMPLETED: 'AppointmentCompleted',
  NO_SHOW: 'AppointmentNoShow',
};
