import type { EventEnvelope, RequestContext, SimulationMarker } from '@serviceform/contracts';
import type { DocumentClass, JobStatus } from '../domain/states.js';
import type { ExtractedField } from '../domain/parse-extraction.js';
import type { RedactionSummary } from '../domain/redaction.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface ExtractionPolicy {
  policy_id: string;
  policy_code: string;
  version_no: number;
  status: 'ACTIVE' | 'RETIRED';
  allowed_content_types: string[];
  min_confidence: number;
  max_excerpt_chars: number;
  gateway_policy_id: string;
  gateway_policy_version: number;
  latency_budget_ms: number;
}

export interface JobRow {
  tenant_id: string;
  job_id: string;
  cell_id: string;
  policy_id: string;
  source_document_id: string;
  source_checksum_sha256: string;
  source_content_type: string;
  purpose: string;
  data_classification: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
  status: JobStatus;
  document_class: DocumentClass | null;
  class_confidence: number | null;
  overall_confidence: number | null;
  ocr_text_hash: string | null;
  ocr_confidence: number | null;
  redaction_summary: RedactionSummary;
  extracted_fields: ExtractedField[];
  provider_id: string | null;
  model_id: string | null;
  model_version: string | null;
  prompt_id: string | null;
  prompt_version: number | null;
  prompt_hash: string | null;
  gateway_request_id: string | null;
  provenance: Record<string, unknown>;
  rejection_code: string | null;
  review_decision: 'CONFIRM_ASSISTIVE' | 'DISCARD' | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ocr_mode: 'SIMULATED';
  simulation: SimulationMarker | null;
  advisory_only: true;
  statutory_decision: false;
  evidence_satisfied: false;
  entitlement_issued: false;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface NewJob {
  job_id: string;
  cell_id: string;
  policy_id: string;
  source_document_id: string;
  source_checksum_sha256: string;
  source_content_type: string;
  purpose: string;
  data_classification: JobRow['data_classification'];
  ocr_mode: 'SIMULATED';
  simulation: SimulationMarker;
  now: string;
}

export interface JobPatch {
  status: JobStatus;
  document_class?: DocumentClass | null;
  class_confidence?: number | null;
  overall_confidence?: number | null;
  ocr_text_hash?: string | null;
  ocr_confidence?: number | null;
  redaction_summary?: RedactionSummary;
  extracted_fields?: ExtractedField[];
  provider_id?: string | null;
  model_id?: string | null;
  model_version?: string | null;
  prompt_id?: string | null;
  prompt_version?: number | null;
  prompt_hash?: string | null;
  gateway_request_id?: string | null;
  provenance?: Record<string, unknown>;
  rejection_code?: string | null;
  review_decision?: 'CONFIRM_ASSISTIVE' | 'DISCARD' | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  now: string;
}

export interface DocIntelTx {
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
  latestPolicy(code: string): Promise<ExtractionPolicy | null>;
  policyById(id: string): Promise<ExtractionPolicy | null>;
  insertPolicy(row: ExtractionPolicy & { created_by: string }): Promise<void>;
  insertJob(row: NewJob): Promise<void>;
  getJob(id: string): Promise<JobRow | null>;
  lockJob(id: string): Promise<JobRow | null>;
  updateJob(id: string, patch: JobPatch): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface DocIntelRepository {
  withTx<T>(ctx: RequestContext, fn: (tx: DocIntelTx) => Promise<T>): Promise<T>;
  inTransaction(): boolean;
}
