import type { CaseState, RequestKind, RequestStatus, TransitionClass } from '../domain/model.js';
import type { PinGraph } from '../domain/pins.js';
import type { ActorType, EventEnvelope } from '../domain/validate.js';

/** SF-CON-DB-SESSION-CONTEXT values applied with set_config(..., true) per transaction. */
export interface DbSession {
  tenantId: string;
  cellId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
}

export interface CaseRow {
  application_id: string;
  tenant_id: string;
  cell_id: string;
  service_id: string;
  applicant_id: string;
  organisation_id: string | null;
  jurisdiction_id: string | null;
  state: CaseState;
  aggregate_version: number;
  pins: PinGraph;
  pin_graph_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  last_correlation_id: string;
}

export interface TransitionRow {
  transition_id: string;
  tenant_id: string;
  application_id: string;
  command: string;
  from_state: CaseState | null;
  to_state: CaseState;
  transition_key: string | null;
  transition_class: TransitionClass | null;
  aggregate_version: number;
  idempotency_key: string;
  authz_decision_id: string;
  authz_policy_revision: string;
  correlation_id: string;
  actor_type: ActorType;
  actor_id: string;
  reason_code: string | null;
  request_id: string | null;
  policy_ref: string | null;
  occurred_at: string;
}

export interface RequestRow {
  request_id: string;
  tenant_id: string;
  application_id: string;
  kind: RequestKind;
  status: RequestStatus;
  workflow_ref: string | null;
  status_reason_code: string | null;
  case_state_at_request: CaseState;
  consumed_at_version: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
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
  | { state: 'completed'; fingerprint: string; response: StoredResponse }
  | { state: 'pending'; fingerprint: string };

/**
 * One short authoritative transaction. Implementations must not perform network I/O other than to
 * PostgreSQL, and every method runs inside the caller's withTx scope.
 */
export interface CaseTx {
  lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup>;
  claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse>;
  completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void>;
  insertCase(row: CaseRow): Promise<void>;
  getCase(applicationId: string, opts?: { forUpdate?: boolean }): Promise<CaseRow | null>;
  updateCaseState(params: {
    applicationId: string;
    fromState: CaseState;
    toState: CaseState;
    fromVersion: number;
    updatedAt: string;
    submittedAt: string | null;
    correlationId: string;
  }): Promise<boolean>;
  insertTransition(row: TransitionRow): Promise<void>;
  listTransitions(applicationId: string): Promise<TransitionRow[]>;
  insertRequest(row: RequestRow): Promise<void>;
  getRequest(requestId: string, opts?: { forUpdate?: boolean }): Promise<RequestRow | null>;
  updateRequestStatus(params: {
    requestId: string;
    fromStatus: RequestStatus;
    toStatus: RequestStatus;
    reasonCode: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean>;
  consumeRequest(params: {
    requestId: string;
    atVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface CaseStore {
  withTx<T>(session: DbSession, fn: (tx: CaseTx) => Promise<T>): Promise<T>;
}
