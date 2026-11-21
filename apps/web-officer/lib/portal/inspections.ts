import {
  SAMPLE_LAB_INSPECTION_ASSIGNMENT,
  SAMPLE_LAB_INSPECTION_PINS,
  SAMPLE_LAB_VERIFICATION_RESULTS,
  isSampleLabVerificationResult,
  pinForCode,
  verificationResultLabel,
  type SampleLabInspectionPin,
  type SampleLabVerificationResult,
} from '@serviceform/m10-sample-lab/inspection-catalogue';

export interface PlatformInspection {
  inspection_id: string;
  application_id: string;
  workflow_node_id?: string;
  inspection_state: string;
  verification_result?: string;
  statutory_effect: false;
  aggregate_version: number;
  assignment: {
    role_code: string;
    organisation_id: string;
    office_id?: string;
    jurisdiction_id: string;
    service_scope_id?: string;
  };
  schedule: {
    window_start?: string;
    window_end?: string;
    slot_ref?: string;
    location_ref?: string;
    timezone_iana?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface PortalInspectionCard {
  inspection_id: string;
  application_id: string;
  workflow_node_id: string | null;
  inspection_state: string;
  state_label: string;
  verification_result: string | null;
  verification_label: string | null;
  pin_label: string | null;
  can_schedule: boolean;
  can_start: boolean;
  can_record_result: boolean;
  can_complete: boolean;
  can_cancel: boolean;
  schedule_summary: string | null;
}

const STATE_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function toInspectionCard(row: PlatformInspection): PortalInspectionCard {
  const pin =
    SAMPLE_LAB_INSPECTION_PINS.find((p) => p.workflow_node_id === row.workflow_node_id) ?? null;
  const result = row.verification_result ?? null;
  const scheduleParts = [
    row.schedule.window_start ? `from ${row.schedule.window_start}` : null,
    row.schedule.window_end ? `to ${row.schedule.window_end}` : null,
    row.schedule.slot_ref ? `slot ${row.schedule.slot_ref}` : null,
    row.schedule.location_ref ? `loc ${row.schedule.location_ref}` : null,
  ].filter(Boolean);
  return {
    inspection_id: row.inspection_id,
    application_id: row.application_id,
    workflow_node_id: row.workflow_node_id ?? null,
    inspection_state: row.inspection_state,
    state_label: STATE_LABELS[row.inspection_state] ?? row.inspection_state,
    verification_result: result,
    verification_label: result ? verificationResultLabel(result) : null,
    pin_label: pin?.label ?? null,
    can_schedule: row.inspection_state === 'REQUESTED',
    can_start: row.inspection_state === 'REQUESTED' || row.inspection_state === 'SCHEDULED',
    can_record_result: row.inspection_state === 'IN_PROGRESS',
    can_complete: row.inspection_state === 'IN_PROGRESS' && Boolean(row.verification_result),
    can_cancel:
      row.inspection_state === 'REQUESTED' ||
      row.inspection_state === 'SCHEDULED' ||
      row.inspection_state === 'IN_PROGRESS',
    schedule_summary: scheduleParts.length > 0 ? scheduleParts.join(' · ') : null,
  };
}

export function labCreateBody(params: {
  application_id: string;
  pin_code: string;
  service_scope_id?: string | null;
}): { application_id: string; workflow_node_id: string; assignment: Record<string, unknown> } | null {
  const pin = pinForCode(params.pin_code);
  if (!pin) return null;
  const assignment: Record<string, unknown> = {
    role_code: SAMPLE_LAB_INSPECTION_ASSIGNMENT.role_code,
    organisation_id: SAMPLE_LAB_INSPECTION_ASSIGNMENT.organisation_id,
    jurisdiction_id: SAMPLE_LAB_INSPECTION_ASSIGNMENT.jurisdiction_id,
  };
  if (SAMPLE_LAB_INSPECTION_ASSIGNMENT.office_id) {
    assignment['office_id'] = SAMPLE_LAB_INSPECTION_ASSIGNMENT.office_id;
  }
  if (params.service_scope_id) {
    assignment['service_scope_id'] = params.service_scope_id;
  }
  return {
    application_id: params.application_id,
    workflow_node_id: pin.workflow_node_id,
    assignment,
  };
}

export function parseResultCode(value: unknown): SampleLabVerificationResult | null {
  return isSampleLabVerificationResult(value) ? value : null;
}

export { SAMPLE_LAB_INSPECTION_PINS, SAMPLE_LAB_VERIFICATION_RESULTS, pinForCode };
export type { SampleLabInspectionPin, SampleLabVerificationResult };
