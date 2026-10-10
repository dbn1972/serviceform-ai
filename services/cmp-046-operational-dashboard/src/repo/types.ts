import type {
  OpsMetric,
  RefreshOutcome,
  SourceComponent,
  ViewCode,
  ViewStatus,
} from '../domain/model.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface SnapshotRow {
  tenant_id: string;
  snapshot_id: string;
  view_code: ViewCode;
  source_component: SourceComponent;
  status: ViewStatus;
  metrics: OpsMetric[];
  source_observed_at: string | null;
  /** Server time of the last successful refresh; null until one succeeds. */
  as_of: string | null;
  last_attempt_at: string;
  last_error_code: string | null;
  snapshot_version: number;
  created_at: string;
  updated_at: string;
}

export interface RefreshLogRow {
  tenant_id: string;
  refresh_id: string;
  view_code: ViewCode;
  outcome: RefreshOutcome;
  error_code: string | null;
  resulting_status: ViewStatus;
  attempted_at: string;
  actor_id: string;
  correlation_id: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface OpsTx {
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
  getSnapshot(viewCode: ViewCode): Promise<SnapshotRow | undefined>;
  getSnapshotForUpdate(viewCode: ViewCode): Promise<SnapshotRow | undefined>;
  listSnapshots(): Promise<SnapshotRow[]>;
  insertSnapshot(row: SnapshotRow): Promise<void>;
  updateSnapshot(row: SnapshotRow): Promise<void>;
  insertRefreshLog(row: RefreshLogRow): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface OpsRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: OpsTx) => Promise<T>): Promise<T>;
}
