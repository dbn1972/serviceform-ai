import type { EventEnvelope, RequestContext } from '../contracts.js';
import type { AppellateAuthority } from '../domain/authority.js';
import type { AdmissibilityCode, AppealState, NoteKind, Operation } from '../domain/states.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface AppealRow {
  tenant_id: string;
  appeal_id: string;
  original_application_id: string;
  original_case_id: string | null;
  original_decision_id: string | null;
  cell_id: string;
  appeal_state: AppealState;
  grounds_code: string;
  evidence_refs: string[];
  admissibility_code: AdmissibilityCode;
  admissibility_reason_code: string | null;
  authority: AppellateAuthority;
  workflow_instance_id: string | null;
  workflow_version_id: string | null;
  hearing_ref: string | null;
  review_ref: string | null;
  decision_ref: string | null;
  original_case_command_ref: string | null;
  created_by: string;
  correlation_id: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface NewAppeal {
  appeal_id: string;
  original_application_id: string;
  original_case_id: string | null;
  original_decision_id: string | null;
  cell_id: string;
  grounds_code: string;
  evidence_refs: string[];
  authority: AppellateAuthority;
  created_by: string;
  correlation_id: string;
  now: Date;
}

export interface AppealPatch {
  appeal_state: AppealState;
  admissibility_code: AdmissibilityCode;
  admissibility_reason_code: string | null;
  authority: AppellateAuthority;
  workflow_instance_id: string | null;
  workflow_version_id: string | null;
  hearing_ref: string | null;
  review_ref: string | null;
  decision_ref: string | null;
  original_case_command_ref: string | null;
  original_case_id: string | null;
  original_decision_id: string | null;
  evidence_refs: string[];
  expected_version: number;
  now: Date;
}

export interface HistoryRow {
  history_id: string;
  appeal_id: string;
  seq: number;
  operation: Operation;
  from_state: AppealState | null;
  to_state: AppealState;
  actor_type: string;
  actor_id: string;
  authority: AppellateAuthority;
  admissibility_code: AdmissibilityCode | null;
  review_ref: string | null;
  hearing_ref: string | null;
  decision_ref: string | null;
  authz_decision_id: string;
  policy_revision: string;
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string;
}

export type NewHistory = Omit<HistoryRow, 'occurred_at' | 'seq'> & { now: Date };

export interface AssistNoteRow {
  note_id: string;
  appeal_id: string;
  note_kind: NoteKind;
  content_ref: string;
  created_by: string;
  created_at: string;
}

export interface AppealReadTx {
  getAppeal(appealId: string): Promise<AppealRow | null>;
  listHistory(appealId: string): Promise<HistoryRow[]>;
  listNotes(appealId: string): Promise<AssistNoteRow[]>;
}

export interface AppealWriteTx extends AppealReadTx {
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
  lockAppeal(appealId: string): Promise<AppealRow | null>;
  insertAppeal(row: NewAppeal): Promise<AppealRow>;
  updateAppeal(appealId: string, patch: AppealPatch): Promise<AppealRow>;
  insertHistory(row: NewHistory): Promise<HistoryRow>;
  insertNote(row: {
    note_id: string;
    appeal_id: string;
    note_kind: NoteKind;
    content_ref: string;
    created_by: string;
    correlation_id: string;
    now: Date;
  }): Promise<AssistNoteRow>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface AppealRepository {
  read<T>(ctx: RepoContext, fn: (tx: AppealReadTx) => Promise<T>): Promise<T>;
  write<T>(ctx: RepoContext, fn: (tx: AppealWriteTx) => Promise<T>): Promise<T>;
}

export type RepoContext = RequestContext & { tenant_id: string };
