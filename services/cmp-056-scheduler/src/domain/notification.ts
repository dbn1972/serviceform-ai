import type { ActorType } from '../types.js';
import type { LifecycleStatus } from './appointment.js';

export type NotificationResult = 'SUCCEEDED' | 'FAILED';

/** Append-only CMP-025 delivery outcome. It never changes the appointment it refers to. */
export interface NotificationOutcomeRow {
  tenant_id: string;
  outcome_id: string;
  appointment_id: string;
  outcome: NotificationResult;
  outcome_ref: string;
  failure_code: string | null;
  actor_type: ActorType;
  recorded_by: string;
  correlation_id: string;
  recorded_at: string;
}

export interface NotificationOutcomeView {
  outcome_id: string;
  appointment_id: string;
  outcome: NotificationResult;
  outcome_ref: string;
  failure_code: string | null;
  recorded_at: string;
  appointment_lifecycle_status: LifecycleStatus;
  booking_invalidated: false;
}

export function notificationOutcomeView(
  row: NotificationOutcomeRow,
  appointmentStatus: LifecycleStatus,
): NotificationOutcomeView {
  return {
    outcome_id: row.outcome_id,
    appointment_id: row.appointment_id,
    outcome: row.outcome,
    outcome_ref: row.outcome_ref,
    failure_code: row.failure_code,
    recorded_at: row.recorded_at,
    appointment_lifecycle_status: appointmentStatus,
    booking_invalidated: false,
  };
}
