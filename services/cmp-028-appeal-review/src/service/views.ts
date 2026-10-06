import type { AppellateAuthority } from '../domain/authority.js';
import type { AdmissibilityCode, AppealState, NoteKind, Operation } from '../domain/states.js';
import type { AppealRow, AssistNoteRow, HistoryRow } from '../repo/types.js';

export interface AuthorityView {
  role_code: string;
  organisation_id: string;
  office_id?: string;
  jurisdiction_id: string;
  service_scope_id?: string;
}

export interface AppealView {
  appeal_id: string;
  original_application_id: string;
  original_case_id?: string;
  original_decision_id?: string;
  appeal_state: AppealState;
  grounds_code: string;
  evidence_refs: string[];
  admissibility_code: AdmissibilityCode;
  admissibility_reason_code?: string;
  appellate_authority: AuthorityView;
  workflow_instance_id?: string;
  workflow_version_id?: string;
  hearing_ref?: string;
  review_ref?: string;
  decision_ref?: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryView {
  seq: number;
  operation: Operation;
  from_state: AppealState | null;
  to_state: AppealState;
  actor_type: string;
  actor_id: string;
  appellate_authority: AuthorityView;
  authz_decision_id: string;
  policy_revision: string;
  occurred_at: string;
}

export interface NoteView {
  note_id: string;
  note_kind: NoteKind;
  content_ref: string;
  created_at: string;
}

export function authorityView(a: AppellateAuthority): AuthorityView {
  const out: AuthorityView = {
    role_code: a.role_code,
    organisation_id: a.organisation_id,
    jurisdiction_id: a.jurisdiction_id,
  };
  if (a.office_id) out.office_id = a.office_id;
  if (a.service_scope_id) out.service_scope_id = a.service_scope_id;
  return out;
}

export function appealView(t: AppealRow): AppealView {
  const v: AppealView = {
    appeal_id: t.appeal_id,
    original_application_id: t.original_application_id,
    appeal_state: t.appeal_state,
    grounds_code: t.grounds_code,
    evidence_refs: t.evidence_refs,
    admissibility_code: t.admissibility_code,
    appellate_authority: authorityView(t.authority),
    aggregate_version: t.aggregate_version,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
  if (t.original_case_id) v.original_case_id = t.original_case_id;
  if (t.original_decision_id) v.original_decision_id = t.original_decision_id;
  if (t.admissibility_reason_code) v.admissibility_reason_code = t.admissibility_reason_code;
  if (t.workflow_instance_id) v.workflow_instance_id = t.workflow_instance_id;
  if (t.workflow_version_id) v.workflow_version_id = t.workflow_version_id;
  if (t.hearing_ref) v.hearing_ref = t.hearing_ref;
  if (t.review_ref) v.review_ref = t.review_ref;
  if (t.decision_ref) v.decision_ref = t.decision_ref;
  return v;
}

export function historyView(h: HistoryRow): HistoryView {
  return {
    seq: h.seq,
    operation: h.operation,
    from_state: h.from_state,
    to_state: h.to_state,
    actor_type: h.actor_type,
    actor_id: h.actor_id,
    appellate_authority: authorityView(h.authority),
    authz_decision_id: h.authz_decision_id,
    policy_revision: h.policy_revision,
    occurred_at: h.occurred_at,
  };
}

export function noteView(n: AssistNoteRow): NoteView {
  return {
    note_id: n.note_id,
    note_kind: n.note_kind,
    content_ref: n.content_ref,
    created_at: n.created_at,
  };
}

export function appealEventData(params: {
  operation: Operation;
  appeal: AppealRow;
  authzDecisionId: string;
  idempotencyKey: string;
  correlationId: string;
}): Record<string, unknown> {
  const t = params.appeal;
  const data: Record<string, unknown> = {
    owner_component: 'CMP-028',
    tenant_id: t.tenant_id,
    appeal_id: t.appeal_id,
    original_application_id: t.original_application_id,
    operation: params.operation,
    appeal_state: t.appeal_state,
    grounds_code: t.grounds_code,
    admissibility_code: t.admissibility_code,
    appellate_authority: authorityView(t.authority),
    authz_decision_id: params.authzDecisionId,
    idempotency_key: params.idempotencyKey,
    correlation_id: params.correlationId,
  };
  if (t.original_decision_id) data['original_decision_id'] = t.original_decision_id;
  if (t.decision_ref) data['decision_ref'] = t.decision_ref;
  if (t.workflow_instance_id) data['workflow_instance_id'] = t.workflow_instance_id;
  return data;
}
