/**
 * SAMPLE_LAB appointment / scheduler catalogue (CMP-056 · Constitution #37).
 * Opaque metadata refs only — no invented hearing/inspection statutory calendars.
 * CERTIFIED=false · G6=false.
 */

export const SAMPLE_LAB_SCHEDULER_ADMIN_ROLE = 'SAMPLE_LAB_SCHEDULER_ADMIN' as const;
export const SAMPLE_LAB_SCHEDULER_DESK_ROLE = 'SAMPLE_LAB_INSPECTION_OFFICER' as const;

export const SAMPLE_LAB_SCHEDULER_WORKLOAD = {
  actor_id: '05605605-0000-4000-8000-056056056056',
  roles: [SAMPLE_LAB_SCHEDULER_ADMIN_ROLE] as const,
} as const;

export interface SampleLabAppointmentType {
  appointment_type_ref: string;
  resource_calendar_ref: string | null;
  label: string;
  description: string;
  /** Optional CMP-018 pin this booking type sits beside (metadata link only). */
  related_inspection_pin: string | null;
  catalogue_id: string | null;
}

export interface SampleLabSlotTemplate {
  appointment_type_ref: string;
  slot_ref: string;
  capacity: number;
  /** Hours from seed time until opens_at. */
  opens_offset_hours: number;
  /** Slot length in hours (closes_at = opens_at + duration). */
  duration_hours: number;
  label: string;
}

/**
 * SAMPLE_LAB metadata: release a CMP-016 WAIT node via CMP-015 command when an
 * appointment lifecycle event commits (no polling). Not statute.
 */
export interface SampleLabAppointmentWaitBinding {
  binding_id: string;
  appointment_type_ref: string;
  on_lifecycle_status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'BOOKED' | 'RESCHEDULED';
  case_expected_state: string;
  case_command: string;
  workflow_wait_node_id: string;
  label: string;
}

export const SAMPLE_LAB_APPOINTMENT_TYPES: readonly SampleLabAppointmentType[] = [
  {
    appointment_type_ref: 'meta:appointment-type:site-visit',
    resource_calendar_ref: 'meta:calendar:sample-lab-working-week',
    label: 'Site visit appointment',
    description:
      'SAMPLE_LAB opaque booking type for licence/site verification visits (beside CMP-018 SITE_VISIT)',
    related_inspection_pin: 'TRADE_LICENCE_SITE_VISIT',
    catalogue_id: 'IND-LIC-001',
  },
  {
    appointment_type_ref: 'meta:appointment-type:factory-inspection',
    resource_calendar_ref: 'meta:calendar:sample-lab-working-week',
    label: 'Factory inspection appointment',
    description:
      'SAMPLE_LAB opaque booking type for factory verification visits (beside CMP-018 FACTORY_INSPECTION)',
    related_inspection_pin: 'FACTORY_LICENCE_INSPECTION',
    catalogue_id: 'IND-LIC-FACTORY-001',
  },
  {
    appointment_type_ref: 'meta:appointment-type:counter-visit',
    resource_calendar_ref: 'meta:calendar:sample-lab-working-week',
    label: 'Counter / interview appointment',
    description: 'Catalogue-agnostic SAMPLE_LAB counter visit / interview slot (not statute)',
    related_inspection_pin: null,
    catalogue_id: null,
  },
] as const;

export const SAMPLE_LAB_SLOT_TEMPLATES: readonly SampleLabSlotTemplate[] = [
  {
    appointment_type_ref: 'meta:appointment-type:site-visit',
    slot_ref: 'slot:sample-lab:site-visit:morning-1',
    capacity: 1,
    opens_offset_hours: 24,
    duration_hours: 2,
    label: 'Site visit · morning',
  },
  {
    appointment_type_ref: 'meta:appointment-type:site-visit',
    slot_ref: 'slot:sample-lab:site-visit:afternoon-1',
    capacity: 1,
    opens_offset_hours: 30,
    duration_hours: 2,
    label: 'Site visit · afternoon',
  },
  {
    appointment_type_ref: 'meta:appointment-type:factory-inspection',
    slot_ref: 'slot:sample-lab:factory:morning-1',
    capacity: 1,
    opens_offset_hours: 48,
    duration_hours: 3,
    label: 'Factory inspection · morning',
  },
  {
    appointment_type_ref: 'meta:appointment-type:counter-visit',
    slot_ref: 'slot:sample-lab:counter:window-1',
    capacity: 2,
    opens_offset_hours: 12,
    duration_hours: 1,
    label: 'Counter window',
  },
] as const;

export function appointmentTypeByRef(ref: string): SampleLabAppointmentType | null {
  return SAMPLE_LAB_APPOINTMENT_TYPES.find((t) => t.appointment_type_ref === ref) ?? null;
}

export function slotTemplateByRef(ref: string): SampleLabSlotTemplate | null {
  return SAMPLE_LAB_SLOT_TEMPLATES.find((s) => s.slot_ref === ref) ?? null;
}

export function appointmentTypeLabel(ref: string): string {
  return appointmentTypeByRef(ref)?.label ?? ref;
}

export const LIFECYCLE_LABELS: Record<string, string> = {
  BOOKED: 'Booked',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
};

export function lifecycleLabel(status: string): string {
  return LIFECYCLE_LABELS[status] ?? status;
}

/** Opaque participant refs for citizen self-serve / application wait correlation. */
export function citizenParticipantRef(citizenId: string): string {
  return `participant:citizen:${citizenId}`;
}

export function applicationParticipantRef(applicationId: string): string {
  return `participant:application:${applicationId}`;
}

const APP_PARTICIPANT_RE =
  /^participant:application:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parseApplicationParticipantRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = APP_PARTICIPANT_RE.exec(ref);
  return m?.[1] ?? null;
}

/**
 * When a site-visit appointment COMPLETED while the case is in VERIFICATION,
 * release WAIT_VERIFICATION → DECISION_PENDING (CMP-015 ENTER_DECISION_PENDING).
 * Metadata only — no invented statutory calendar.
 */
export const SAMPLE_LAB_APPOINTMENT_WAIT_BINDINGS: readonly SampleLabAppointmentWaitBinding[] = [
  {
    binding_id: 'wait:sample-lab:verification-on-site-visit-complete',
    appointment_type_ref: 'meta:appointment-type:site-visit',
    on_lifecycle_status: 'COMPLETED',
    case_expected_state: 'VERIFICATION',
    case_command: 'ENTER_DECISION_PENDING',
    workflow_wait_node_id: 'WAIT_VERIFICATION',
    label: 'Release verification wait when site-visit appointment completes',
  },
  {
    binding_id: 'wait:sample-lab:verification-on-factory-complete',
    appointment_type_ref: 'meta:appointment-type:factory-inspection',
    on_lifecycle_status: 'COMPLETED',
    case_expected_state: 'VERIFICATION',
    case_command: 'ENTER_DECISION_PENDING',
    workflow_wait_node_id: 'WAIT_VERIFICATION',
    label: 'Release verification wait when factory-inspection appointment completes',
  },
] as const;

export function waitBindingsForEvent(
  appointmentTypeRef: string,
  lifecycleStatus: string,
): SampleLabAppointmentWaitBinding[] {
  return SAMPLE_LAB_APPOINTMENT_WAIT_BINDINGS.filter(
    (b) =>
      b.appointment_type_ref === appointmentTypeRef && b.on_lifecycle_status === lifecycleStatus,
  );
}
