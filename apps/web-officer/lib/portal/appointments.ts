import {
  SAMPLE_LAB_APPOINTMENT_TYPES,
  SAMPLE_LAB_SLOT_TEMPLATES,
  appointmentTypeByRef,
  appointmentTypeLabel,
  lifecycleLabel,
  type SampleLabAppointmentType,
} from '@serviceform/m10-sample-lab/appointment-catalogue';

export interface PlatformSlot {
  slot_id: string;
  slot_ref: string;
  appointment_type_id: string;
  capacity: number;
  booked_count: number;
  remaining: number;
  capacity_atomic: boolean;
  opens_at: string;
  closes_at: string;
}

export interface PlatformAppointmentView {
  appointment: {
    appointment_id: string;
    appointment_type_ref: string;
    lifecycle_status: string;
    slot_ref: string;
    resource_calendar_ref?: string | null;
    capacity_atomic: boolean;
    notification_failure_invalidates_booking: boolean;
    invented_statutory_policy_forbidden: boolean;
  };
  appointment_version: number;
  notification_status: string;
  participant_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalSlotCard {
  slot_id: string;
  slot_ref: string;
  appointment_type_id: string;
  appointment_type_ref: string | null;
  type_label: string | null;
  capacity: number;
  remaining: number;
  opens_at: string;
  closes_at: string;
  label: string;
  can_book: boolean;
}

export interface PortalAppointmentCard {
  appointment_id: string;
  appointment_type_ref: string;
  type_label: string;
  lifecycle_status: string;
  state_label: string;
  slot_ref: string;
  appointment_version: number;
  notification_status: string;
  participant_ref: string | null;
  related_inspection_pin: string | null;
  can_reschedule: boolean;
  can_cancel: boolean;
  can_complete: boolean;
  can_no_show: boolean;
}

const ACTIVE = new Set(['BOOKED', 'RESCHEDULED']);

export function toSlotCard(
  row: PlatformSlot,
  typeRefById?: ReadonlyMap<string, string>,
): PortalSlotCard {
  const typeRef = typeRefById?.get(row.appointment_type_id) ?? null;
  const type = typeRef ? appointmentTypeByRef(typeRef) : null;
  const template = SAMPLE_LAB_SLOT_TEMPLATES.find((s) => s.slot_ref === row.slot_ref);
  return {
    slot_id: row.slot_id,
    slot_ref: row.slot_ref,
    appointment_type_id: row.appointment_type_id,
    appointment_type_ref: typeRef,
    type_label: type?.label ?? (typeRef ? appointmentTypeLabel(typeRef) : null),
    capacity: row.capacity,
    remaining: row.remaining,
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    label: template?.label ?? row.slot_ref,
    can_book: row.remaining > 0,
  };
}

export function toAppointmentCard(view: PlatformAppointmentView): PortalAppointmentCard {
  const status = view.appointment.lifecycle_status;
  const type = appointmentTypeByRef(view.appointment.appointment_type_ref);
  return {
    appointment_id: view.appointment.appointment_id,
    appointment_type_ref: view.appointment.appointment_type_ref,
    type_label: type?.label ?? appointmentTypeLabel(view.appointment.appointment_type_ref),
    lifecycle_status: status,
    state_label: lifecycleLabel(status),
    slot_ref: view.appointment.slot_ref,
    appointment_version: view.appointment_version,
    notification_status: view.notification_status,
    participant_ref: view.participant_ref,
    related_inspection_pin: type?.related_inspection_pin ?? null,
    can_reschedule: ACTIVE.has(status),
    can_cancel: ACTIVE.has(status),
    can_complete: ACTIVE.has(status),
    can_no_show: ACTIVE.has(status),
  };
}

export function typeRefMapFromCatalogue(
  types: readonly SampleLabAppointmentType[],
  seededTypeIds: Readonly<Record<string, string>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [ref, id] of Object.entries(seededTypeIds)) {
    map.set(id, ref);
  }
  // Prefer catalogue labels even when seed map is empty (UI can still show template labels by slot_ref).
  void types;
  return map;
}

export { SAMPLE_LAB_APPOINTMENT_TYPES, SAMPLE_LAB_SLOT_TEMPLATES, appointmentTypeByRef };
export type { SampleLabAppointmentType };
