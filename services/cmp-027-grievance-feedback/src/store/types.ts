import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { Assignment, GrievanceKind, GrievanceStatus } from '../domain/model.js';

export interface DbSession {
  tenantId: string;
  cellId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
}

export interface GrievanceRow {
  grievance_id: string;
  tenant_id: string;
  cell_id: string;
  kind: GrievanceKind;
  status: GrievanceStatus;
  aggregate_version: number;
  reference_code: string;
  category_code: string | null;
  filer_id: string;
  organisation_id: string | null;
  jurisdiction_id: string | null;
  office_id: string | null;
  service_id: string | null;
  application_id: string | null;
  workflow_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface TransitionRow {
  transition_id: string;
  tenant_id: string;
  grievance_id: string;
  command: string;
  from_status: GrievanceStatus | null;
  to_status: GrievanceStatus;
  aggregate_version: number;
  idempotency_key: string;
  authz_decision_id: string;
  authz_policy_revision: string;
  correlation_id: string;
  actor_type: ActorType;
  actor_id: string;
  reason_code: string | null;
  policy_ref: string | null;
  occurred_at: string;
}

export interface ResponseRow {
  response_id: string;
  tenant_id: string;
  grievance_id: string;
  author_actor_type: ActorType;
  author_id: string;
  body_ref: string;
  created_at: string;
  correlation_id: string;
}

export interface AssignmentRequestRow {
  request_id: string;
  tenant_id: string;
  grievance_id: string;
  assignment: Assignment;
  status: 'REQUESTED';
  created_at: string;
  correlation_id: string;
}

export interface AiAssistRow {
  assist_id: string;
  tenant_id: string;
  grievance_id: string;
  kind: string;
  suggestion_code: string | null;
  duplicate_of_id: string | null;
  created_at: string;
  correlation_id: string;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyKeyRef {
  principalId: string;
  endpoint: string;
  key: string;
}

export type IdempotencyLookup =
  | { state: 'absent' }
  | { state: 'pending'; fingerprint: string }
  | { state: 'completed'; fingerprint: string; response: StoredResponse };

export interface GrievanceTx {
  lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup>;
  claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse>;
  completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void>;
  insertGrievance(row: GrievanceRow): Promise<void>;
  getGrievance(id: string, opts?: { forUpdate?: boolean }): Promise<GrievanceRow | null>;
  updateGrievance(params: {
    grievanceId: string;
    fromStatus: GrievanceStatus;
    toStatus: GrievanceStatus;
    fromVersion: number;
    categoryCode: string | null;
    organisationId: string | null;
    jurisdictionId: string | null;
    officeId: string | null;
    workflowVersionId: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean>;
  insertTransition(row: TransitionRow): Promise<void>;
  listTransitions(grievanceId: string): Promise<TransitionRow[]>;
  insertResponse(row: ResponseRow): Promise<void>;
  listResponses(grievanceId: string): Promise<ResponseRow[]>;
  insertAssignmentRequest(row: AssignmentRequestRow): Promise<void>;
  getAssignmentRequest(grievanceId: string): Promise<AssignmentRequestRow | null>;
  insertAiAssist(row: AiAssistRow): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface GrievanceStore {
  withTx<T>(session: DbSession, fn: (tx: GrievanceTx) => Promise<T>): Promise<T>;
}
