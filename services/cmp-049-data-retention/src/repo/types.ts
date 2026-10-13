import type { Eligibility } from '../domain/eligibility.js';
import type { RetentionPolicyRecord } from '../domain/policy.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface RetentionSubjectRecord {
  tenant_id: string;
  subject_id: string;
  policy_id: string;
  resource_type: string;
  /** Opaque id of a record owned by another component; CMP-049 never reads that record. */
  resource_id: string;
  eligibility: Eligibility;
  subject_version: number;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface TransitionLogRow {
  tenant_id: string;
  transition_id: string;
  subject_id: string;
  policy_id: string;
  policy_version: number;
  from_eligibility: Eligibility;
  to_eligibility: Eligibility;
  owner_supplied_period_ref: string | null;
  reason_code: string | null;
  subject_version: number;
  actor_id: string;
  correlation_id: string;
  transitioned_at: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface RetentionTx {
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
  insertPolicy(row: RetentionPolicyRecord): Promise<void>;
  getPolicy(policyId: string, forUpdate?: boolean): Promise<RetentionPolicyRecord | undefined>;
  bindPolicyPeriodRef(row: RetentionPolicyRecord): Promise<void>;
  insertSubject(row: RetentionSubjectRecord): Promise<void>;
  getSubject(subjectId: string, forUpdate?: boolean): Promise<RetentionSubjectRecord | undefined>;
  findSubjectByResource(
    resourceType: string,
    resourceId: string,
  ): Promise<RetentionSubjectRecord | undefined>;
  updateSubjectEligibility(row: RetentionSubjectRecord): Promise<void>;
  insertTransition(row: TransitionLogRow): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface RetentionRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: RetentionTx) => Promise<T>): Promise<T>;
}
