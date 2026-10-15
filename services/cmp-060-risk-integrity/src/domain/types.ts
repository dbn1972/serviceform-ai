/**
 * CMP-060 Risk/Integrity domain types.
 * Architecture Constitution rule 40: risk signals are advisory; no adverse outcome from AI score alone.
 * SF-CON-RISK-ASSESSMENT FROZEN: authoritative_decision_by_this_component must always be false.
 */

export type RiskLifecycleStatus =
  'COMPLETED' | 'HIGH_RISK_REVIEW_REQUESTED' | 'DISPOSITION_RECORDED';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ReviewDisposition = 'CLEARED' | 'ESCALATED' | 'REFERRED_ENFORCEMENT';

export interface RiskSignalInput {
  signal_code: string;
  provenance_ref: string;
  model_or_rule_version?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface CreateRiskAssessmentCommand {
  tenant_id: string;
  assessment_id: string;
  subject_application_id: string;
  cell_id: string;
  idempotency_key: string;
  correlation_id?: string | null;
  signals: RiskSignalInput[];
  raw_risk_score?: number | null;
  model_or_rule_version?: string | null;
  actor_type: 'CITIZEN' | 'OFFICER' | 'SYSTEM' | 'INTEGRATION' | 'PRIVILEGED_ADMIN';
  requested_by: string;
}

export interface RecordDispositionCommand {
  tenant_id: string;
  assessment_id: string;
  disposition_id: string;
  disposition: ReviewDisposition;
  disposition_note?: string | null;
  disposed_by: string;
  correlation_id?: string | null;
}

export interface RiskAssessmentRecord {
  tenant_id: string;
  assessment_id: string;
  subject_application_id: string;
  cell_id: string;
  idempotency_key: string;
  correlation_id: string | null;
  /** FROZEN: always false — Constitution rule 40 */
  readonly authoritative_decision_by_this_component: false;
  /** FROZEN: always true — no invented statutory policy */
  readonly invented_statutory_policy_forbidden: true;
  lifecycle_status: RiskLifecycleStatus;
  raw_risk_score: number | null;
  risk_tier: RiskTier | null;
  signal_count: number;
  review_requested_at: Date | null;
  disposition_recorded_at: Date | null;
  actor_type: string;
  requested_by: string;
  model_or_rule_version: string | null;
  recorded_at: Date;
}
