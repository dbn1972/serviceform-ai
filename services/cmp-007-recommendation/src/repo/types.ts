import type { EventEnvelope, RequestContext } from '@serviceform/contracts';
import type { Disposition, RecommendationStatus } from '../domain/states.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface RecommendationPolicy {
  policy_id: string;
  policy_code: string;
  version_no: number;
  status: 'ACTIVE' | 'RETIRED';
  consent_purpose_code: string;
  gateway_policy_id: string;
  gateway_policy_version: number;
  model_route_ref: string;
  allowed_reason_codes: string[];
  allowed_signal_codes: string[];
  max_candidates: number;
  max_results: number;
  latency_budget_ms: number;
}

export interface CandidateSnapshot {
  alias: string;
  service_id: string;
  service_code: string;
  category_code: string | null;
  published_version_ref: string;
}

export interface RecommendationItem {
  rank: number;
  service_id: string;
  published_version_ref: string;
  reason_codes: string[];
}

export interface RecommendationRow {
  tenant_id: string;
  recommendation_id: string;
  cell_id: string;
  subject_id: string;
  application_id: string | null;
  policy_id: string;
  consent_purpose_code: string;
  consent_ref: string | null;
  status: RecommendationStatus;
  candidates: CandidateSnapshot[];
  signals: string[];
  items: RecommendationItem[];
  reason_codes: string[];
  model_route_ref: string;
  provider_id: string | null;
  model_id: string | null;
  model_version: string | null;
  prompt_id: string | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  gateway_request_id: string | null;
  rejection_code: string | null;
  disposition: Disposition | null;
  selected_service_id: string | null;
  disposed_by: string | null;
  disposed_at: string | null;
  correlation_id: string;
  ai_gateway_cmp: 'CMP-039';
  non_authoritative: true;
  authoritative: false;
  statutory_decision: false;
  consent_recorded: true;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface NewRecommendation {
  recommendation_id: string;
  cell_id: string;
  subject_id: string;
  application_id: string | null;
  policy_id: string;
  consent_purpose_code: string;
  consent_ref: string | null;
  candidates: CandidateSnapshot[];
  signals: string[];
  model_route_ref: string;
  correlation_id: string;
  now: string;
}

export interface RecommendationPatch {
  status: RecommendationStatus;
  items?: RecommendationItem[];
  reason_codes?: string[];
  provider_id?: string | null;
  model_id?: string | null;
  model_version?: string | null;
  prompt_id?: string | null;
  prompt_version?: number | null;
  prompt_hash?: string | null;
  gateway_request_id?: string | null;
  rejection_code?: string | null;
  disposition?: Disposition | null;
  selected_service_id?: string | null;
  disposed_by?: string | null;
  disposed_at?: string | null;
  now: string;
}

export interface RecommendationTx {
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
  latestPolicy(code: string): Promise<RecommendationPolicy | null>;
  policyById(id: string): Promise<RecommendationPolicy | null>;
  insertPolicy(row: RecommendationPolicy & { created_by: string }): Promise<void>;
  insertRecommendation(row: NewRecommendation): Promise<void>;
  getRecommendation(id: string): Promise<RecommendationRow | null>;
  lockRecommendation(id: string): Promise<RecommendationRow | null>;
  updateRecommendation(id: string, patch: RecommendationPatch): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface RecommendationRepository {
  withTx<T>(ctx: RequestContext, fn: (tx: RecommendationTx) => Promise<T>): Promise<T>;
  inTransaction(): boolean;
}
