import type {
  DeficiencyOperation,
  DeficiencyStatus,
  ItemStatus,
} from '../domain/model.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface NoticeRow {
  tenant_id: string;
  deficiency_id: string;
  application_id: string;
  cell_id: string;
  status: DeficiencyStatus;
  reason_code: string;
  notice_code: string;
  instruction_ref: string;
  sla_pause_reason_code: string;
  sla_stage_code: string;
  response_due_at: string | null;
  opened_at: string;
  responded_at: string | null;
  closed_at: string | null;
  close_reason_code: string | null;
  opened_by: string;
  closed_by: string | null;
  correlation_id: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  deficiency_id: string;
  item_seq: number;
  item_code: string;
  evidence_requirement_ref: string | null;
  required: boolean;
  item_status: ItemStatus;
}

export interface ResponseRow {
  response_id: string;
  deficiency_id: string;
  narrative_ref: string;
  responded_at: string;
  actor_id: string;
  correlation_id: string;
}

export interface EvidenceRow {
  link_id: string;
  deficiency_id: string;
  response_id: string | null;
  evidence_ref: string;
  kind_code: string;
  attached_by: string;
  attached_at: string;
}

export interface HistoryRow {
  deficiency_id: string;
  sequence_no: number;
  operation: DeficiencyOperation;
  from_status: DeficiencyStatus | null;
  to_status: DeficiencyStatus;
  occurred_at: string;
  reason_code: string | null;
  actor_type: string;
  actor_id: string;
  correlation_id: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface DeficiencyTx {
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
  insertNotice(row: NoticeRow): Promise<void>;
  updateNotice(row: NoticeRow): Promise<void>;
  getNotice(id: string): Promise<NoticeRow | undefined>;
  findActiveByApplication(applicationId: string): Promise<NoticeRow | undefined>;
  listByApplication(applicationId: string): Promise<NoticeRow[]>;
  insertItem(row: ItemRow): Promise<void>;
  markItemsProvided(deficiencyId: string, codes: string[]): Promise<void>;
  listItems(deficiencyId: string): Promise<ItemRow[]>;
  insertResponse(row: ResponseRow): Promise<void>;
  getResponse(deficiencyId: string): Promise<ResponseRow | undefined>;
  insertEvidence(row: EvidenceRow): Promise<void>;
  listEvidence(deficiencyId: string): Promise<EvidenceRow[]>;
  appendHistory(row: HistoryRow): Promise<void>;
  listHistory(deficiencyId: string): Promise<HistoryRow[]>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface DeficiencyRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: DeficiencyTx) => Promise<T>): Promise<T>;
}
