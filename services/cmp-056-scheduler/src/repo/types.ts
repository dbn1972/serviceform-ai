import type {
  AppointmentHistoryRow,
  AppointmentRow,
  LifecycleStatus,
} from '../domain/appointment.js';
import type { NotificationOutcomeRow } from '../domain/notification.js';
import type { SlotRow } from '../domain/slot.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface IdempotencyPeek {
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_status: number | null;
  response_body: unknown;
}

export interface SlotFilter {
  appointment_type_ref: string | null;
  resource_calendar_ref: string | null;
  /** Lower bound on starts_at; the service passes max(now, from). */
  starts_after: string;
  starts_before: string | null;
  limit: number;
}

export interface AppointmentPatch {
  lifecycle_status: LifecycleStatus;
  slot_id: string;
  slot_ref: string;
  resource_calendar_ref: string | null;
  version: number;
  updated_at: string;
}

export interface SchedulerTx {
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
  /** Returns false when slot_ref already exists in the tenant. */
  insertSlot(row: SlotRow): Promise<boolean>;
  getSlotByRef(slotRef: string): Promise<SlotRow | undefined>;
  getSlotById(slotId: string): Promise<SlotRow | undefined>;
  listBookableSlots(filter: SlotFilter): Promise<SlotRow[]>;
  /** Row-locks the given slots in slot_id order (deadlock-free for reschedule). */
  lockSlots(slotIds: string[]): Promise<SlotRow[]>;
  /**
   * Atomically takes one seat: a single conditional UPDATE that succeeds only while the slot is
   * OPEN, not yet started and booked_count < capacity. Returns undefined when no seat was taken.
   */
  reserveSeat(slotId: string, now: string): Promise<SlotRow | undefined>;
  /** Returns one seat to the slot; false when booked_count is already 0. */
  releaseSeat(slotId: string, now: string): Promise<boolean>;
  insertAppointment(row: AppointmentRow): Promise<void>;
  getAppointment(appointmentId: string): Promise<AppointmentRow | undefined>;
  lockAppointment(appointmentId: string): Promise<AppointmentRow | undefined>;
  /** Compare-and-set on version; false when the stored version differs. */
  updateAppointment(
    appointmentId: string,
    expectedVersion: number,
    patch: AppointmentPatch,
  ): Promise<boolean>;
  insertHistory(row: AppointmentHistoryRow): Promise<void>;
  /** Returns false when (appointment, outcome_ref) is already recorded. */
  insertNotificationOutcome(row: NotificationOutcomeRow): Promise<boolean>;
  findNotificationOutcome(
    appointmentId: string,
    outcomeRef: string,
  ): Promise<NotificationOutcomeRow | undefined>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface SchedulerRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T>;
}
