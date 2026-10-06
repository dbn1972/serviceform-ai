import type { Assignment } from '../domain/assignment.js';
import type { VerificationResult } from '../domain/result.js';
import type { InspectionState, Operation } from '../domain/states.js';
import type { InspectionRow } from '../repo/types.js';

export interface AssignmentView {
  role_code: string;
  organisation_id: string;
  office_id?: string;
  jurisdiction_id: string;
  service_scope_id?: string;
  claimed_principal_id?: string;
}

export interface InspectionView {
  inspection_id: string;
  application_id: string;
  prior_inspection_id?: string;
  workflow_node_id?: string;
  inspection_state: InspectionState;
  assignment: AssignmentView;
  schedule: {
    window_start?: string;
    window_end?: string;
    slot_ref?: string;
    location_ref?: string;
    timezone_iana?: string;
  };
  verification_result?: VerificationResult;
  statutory_effect: false;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export function assignmentView(a: Assignment, claimedPrincipalId: string | null): AssignmentView {
  const out: AssignmentView = {
    role_code: a.role_code,
    organisation_id: a.organisation_id,
    jurisdiction_id: a.jurisdiction_id,
  };
  if (a.office_id) out.office_id = a.office_id;
  if (a.service_scope_id) out.service_scope_id = a.service_scope_id;
  if (claimedPrincipalId) out.claimed_principal_id = claimedPrincipalId;
  return out;
}

export function inspectionView(t: InspectionRow): InspectionView {
  const schedule: InspectionView['schedule'] = {};
  if (t.schedule.window_start) schedule.window_start = t.schedule.window_start;
  if (t.schedule.window_end) schedule.window_end = t.schedule.window_end;
  if (t.schedule.slot_ref) schedule.slot_ref = t.schedule.slot_ref;
  if (t.schedule.location_ref) schedule.location_ref = t.schedule.location_ref;
  if (t.schedule.timezone_iana) schedule.timezone_iana = t.schedule.timezone_iana;
  const v: InspectionView = {
    inspection_id: t.inspection_id,
    application_id: t.application_id,
    inspection_state: t.inspection_state,
    assignment: assignmentView(t.assignment, t.claimed_principal_id),
    schedule,
    statutory_effect: false,
    aggregate_version: t.aggregate_version,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
  if (t.prior_inspection_id) v.prior_inspection_id = t.prior_inspection_id;
  if (t.workflow_node_id) v.workflow_node_id = t.workflow_node_id;
  if (t.verification_result) v.verification_result = t.verification_result;
  return v;
}

export function inspectionEventData(params: {
  operation: Operation;
  row: InspectionRow;
  authzDecisionId: string;
  idempotencyKey: string;
  correlationId: string;
}): Record<string, unknown> {
  const t = params.row;
  const data: Record<string, unknown> = {
    inspection_id: t.inspection_id,
    application_id: t.application_id,
    operation: params.operation,
    inspection_state: t.inspection_state,
    assignment: assignmentView(t.assignment, t.claimed_principal_id),
    statutory_effect: false,
    authz_decision_id: params.authzDecisionId,
    idempotency_key: params.idempotencyKey,
    correlation_id: params.correlationId,
  };
  if (t.prior_inspection_id) data['prior_inspection_id'] = t.prior_inspection_id;
  if (t.workflow_node_id) data['workflow_node_id'] = t.workflow_node_id;
  if (t.verification_result) data['verification_result'] = t.verification_result;
  return data;
}
