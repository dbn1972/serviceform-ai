import type { EventEnvelope, RequestContext } from '../contracts.js';
import type { Assignment } from '../domain/assignment.js';
import type { PrincipalScope } from '../domain/resolution.js';
import type { VerificationResult } from '../domain/result.js';
import type { ScheduleMeta } from '../domain/scheduling.js';
import type { InspectionState, Operation } from '../domain/states.js';
import type { TechnicalAcceptance } from '../ports/evidence.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface InspectionRow {
  tenant_id: string;
  inspection_id: string;
  application_id: string;
  prior_inspection_id: string | null;
  workflow_node_id: string | null;
  cell_id: string;
  inspection_state: InspectionState;
  assignment: Assignment;
  claimed_principal_id: string | null;
  claimed_at: string | null;
  schedule: ScheduleMetaView;
  verification_result: VerificationResult | null;
  statutory_effect: false;
  created_by: string;
  correlation_id: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleMetaView {
  window_start: string | null;
  window_end: string | null;
  slot_ref: string | null;
  location_ref: string | null;
  timezone_iana: string | null;
}

export interface NewInspection {
  inspection_id: string;
  application_id: string;
  prior_inspection_id: string | null;
  workflow_node_id: string | null;
  cell_id: string;
  assignment: Assignment;
  created_by: string;
  correlation_id: string;
  now: Date;
}

export interface InspectionPatch {
  inspection_state: InspectionState;
  assignment: Assignment;
  claimed_principal_id: string | null;
  claimed_at: Date | null;
  schedule: ScheduleMeta;
  verification_result: VerificationResult | null;
  expected_version: number;
  now: Date;
}

export interface HistoryRow {
  history_id: string;
  inspection_id: string;
  seq: number;
  operation: Operation;
  from_state: InspectionState | null;
  to_state: InspectionState;
  actor_type: string;
  actor_id: string;
  assignment: Assignment;
  claimed_principal_id: string | null;
  verification_result: VerificationResult | null;
  statutory_effect: false;
  authz_decision_id: string;
  policy_revision: string;
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string;
}

export type NewHistory = Omit<HistoryRow, 'occurred_at' | 'seq'> & { now: Date };

export interface ChecklistRow {
  item_id: string;
  inspection_id: string;
  item_code: string;
  required: boolean;
  item_state: string;
}

export interface ObservationRow {
  observation_id: string;
  inspection_id: string;
  item_code: string;
  note_ref: string;
  geo_ref: string | null;
  captured_at: string;
  actor_id: string;
}

export interface EvidenceRefRow {
  evidence_ref_id: string;
  inspection_id: string;
  evidence_id: string | null;
  document_id: string | null;
  ocr_job_id: string | null;
  technical_acceptance: TechnicalAcceptance;
  simulation_marker: Record<string, unknown> | null;
}

export interface FindingRow {
  finding_id: string;
  inspection_id: string;
  finding_code: string;
  severity: string;
  related_item_code: string | null;
}

export interface InspectionReadTx {
  getInspection(inspectionId: string): Promise<InspectionRow | null>;
  listAvailable(scope: PrincipalScope, limit: number): Promise<InspectionRow[]>;
  listHistory(inspectionId: string): Promise<HistoryRow[]>;
  listChecklist(inspectionId: string): Promise<ChecklistRow[]>;
  listObservations(inspectionId: string): Promise<ObservationRow[]>;
  listEvidence(inspectionId: string): Promise<EvidenceRefRow[]>;
  listFindings(inspectionId: string): Promise<FindingRow[]>;
}

export interface InspectionWriteTx extends InspectionReadTx {
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
  lockInspection(inspectionId: string): Promise<InspectionRow | null>;
  insertInspection(row: NewInspection): Promise<InspectionRow>;
  updateInspection(inspectionId: string, patch: InspectionPatch): Promise<InspectionRow>;
  insertHistory(row: NewHistory): Promise<HistoryRow>;
  upsertChecklistItem(row: {
    item_id: string;
    inspection_id: string;
    item_code: string;
    required: boolean;
    item_state: string;
    now: Date;
  }): Promise<ChecklistRow>;
  insertObservation(row: {
    observation_id: string;
    inspection_id: string;
    item_code: string;
    note_ref: string;
    geo_ref: string | null;
    captured_at: Date;
    actor_id: string;
  }): Promise<ObservationRow>;
  insertEvidenceRef(row: {
    evidence_ref_id: string;
    inspection_id: string;
    evidence_id: string | null;
    document_id: string | null;
    ocr_job_id: string | null;
    technical_acceptance: TechnicalAcceptance;
    simulation_marker: Record<string, unknown> | null;
  }): Promise<EvidenceRefRow>;
  insertFinding(row: {
    finding_id: string;
    inspection_id: string;
    finding_code: string;
    severity: string;
    related_item_code: string | null;
  }): Promise<FindingRow>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface InspectionRepository {
  read<T>(ctx: RepoContext, fn: (tx: InspectionReadTx) => Promise<T>): Promise<T>;
  write<T>(ctx: RepoContext, fn: (tx: InspectionWriteTx) => Promise<T>): Promise<T>;
}

export type RepoContext = RequestContext & { tenant_id: string };
