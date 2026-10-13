import type { DiscoveryResultItem } from '../domain/availability.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';

/**
 * Persisted query log. Raw keywords are never stored (free text may carry personal data); only
 * their count is kept, so a stored query reproduces the pins and filters but not the text.
 */
export interface DiscoveryQueryRecord {
  tenant_id: string;
  query_id: string;
  actor_type: ActorType;
  actor_id: string;
  catalogue_version_id: string;
  jurisdiction_codes: string[];
  service_codes: string[];
  keyword_count: number;
  pagination_limit: number;
  pagination_offset: number;
  result_count: number;
  excluded_count: number;
  has_more: boolean;
  created_at: string;
  correlation_id: string;
}

export type DiscoveryResultRecord = Omit<DiscoveryResultItem, 'label_key'> & {
  tenant_id: string;
  query_id: string;
};

export interface DiscoverySelectionRecord {
  tenant_id: string;
  selection_id: string;
  query_id: string;
  service_id: string;
  service_code: string;
  service_binding_version_id: string;
  catalogue_version_id: string;
  actor_type: 'CITIZEN';
  actor_id: string;
  selected_at: string;
  correlation_id: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface DiscoveryTx {
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
  insertQuery(row: DiscoveryQueryRecord): Promise<void>;
  insertResults(rows: DiscoveryResultRecord[]): Promise<void>;
  getQuery(queryId: string): Promise<DiscoveryQueryRecord | undefined>;
  getResults(queryId: string): Promise<DiscoveryResultRecord[]>;
  insertSelection(row: DiscoverySelectionRecord): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface DiscoveryRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: DiscoveryTx) => Promise<T>): Promise<T>;
}
