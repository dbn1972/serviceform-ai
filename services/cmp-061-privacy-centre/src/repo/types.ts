import type {
  FulfilmentTaskRecord,
  LifecycleStatus,
  PrivacyRequestRecord,
  ScopeItem,
} from '../domain/request.js';
import type { EventEnvelope, RequestContext } from '../types.js';

export interface DecisionLogRow {
  tenant_id: string;
  decision_id: string;
  request_id: string;
  from_status: LifecycleStatus | null;
  to_status: LifecycleStatus;
  legal_basis_or_exception_ref: string | null;
  request_version: number;
  actor_type: string;
  actor_id: string;
  correlation_id: string;
  decided_at: string;
}

/** Alias kept for callers that prefer the shorter name. */
export type DecisionRow = DecisionLogRow;

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

/** Every method touches sf_privacy only; there is no port to another component's data. */
export interface PrivacyTx {
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
  insertRequest(row: PrivacyRequestRecord): Promise<void>;
  getRequest(requestId: string, forUpdate?: boolean): Promise<PrivacyRequestRecord | undefined>;
  listRequestsForSubject(subjectActorId: string): Promise<PrivacyRequestRecord[]>;
  updateRequest(row: PrivacyRequestRecord): Promise<void>;
  insertScope(
    tenantId: string,
    requestId: string,
    items: readonly ScopeItem[],
    createdAt: string,
  ): Promise<void>;
  listScope(requestId: string): Promise<ScopeItem[]>;
  insertTask(row: FulfilmentTaskRecord): Promise<void>;
  getTask(taskId: string, forUpdate?: boolean): Promise<FulfilmentTaskRecord | undefined>;
  listTasks(requestId: string): Promise<FulfilmentTaskRecord[]>;
  updateTask(row: FulfilmentTaskRecord): Promise<void>;
  insertDecision(row: DecisionLogRow): Promise<void>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface PrivacyRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: PrivacyTx) => Promise<T>): Promise<T>;
}
