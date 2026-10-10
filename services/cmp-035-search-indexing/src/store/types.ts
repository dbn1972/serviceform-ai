import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { Facets } from '../domain/document.js';

export interface DbSession {
  tenantId: string;
  cellId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
}

export type DocumentStatus = 'ACTIVE' | 'REMOVED';

/** Projection row. Source identity and source version are retained; the source stays authoritative. */
export interface SearchDocumentRow {
  document_id: string;
  tenant_id: string;
  cell_id: string;
  source_cmp_id: string;
  source_record_id: string;
  source_aggregate_type: string;
  source_topic: string;
  source_version: number;
  source_event_id: string;
  source_event_type: string;
  source_occurred_at: string;
  projection_rule_id: string;
  projection_rule_version: number;
  facets: Facets;
  status: DocumentStatus;
  revision: number;
  indexed_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface DocumentUpdate {
  documentId: string;
  fromRevision: number;
  fromSourceVersion: number;
  sourceVersion: number;
  sourceEventId: string;
  sourceEventType: string;
  sourceOccurredAt: string;
  projectionRuleId: string;
  projectionRuleVersion: number;
  facets: Facets;
  status: DocumentStatus;
  updatedAt: string;
  correlationId: string;
}

export interface DocumentQuery {
  sourceCmpId: string | null;
  facets: Facets;
  limit: number;
  after: string | null;
}

export interface SearchTx {
  /** Returns false when (consumer_group, event_id) was already applied. */
  recordInbox(consumerGroup: string, eventId: string): Promise<boolean>;
  getDocumentBySource(
    sourceCmpId: string,
    sourceRecordId: string,
    opts?: { forUpdate?: boolean },
  ): Promise<SearchDocumentRow | null>;
  getDocument(documentId: string): Promise<SearchDocumentRow | null>;
  insertDocument(row: SearchDocumentRow): Promise<void>;
  updateDocument(update: DocumentUpdate): Promise<boolean>;
  queryDocuments(query: DocumentQuery): Promise<SearchDocumentRow[]>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface SearchStore {
  withTx<T>(session: DbSession, fn: (tx: SearchTx) => Promise<T>): Promise<T>;
}
