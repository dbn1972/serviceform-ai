import type { TenantContext } from '../types.js';

export interface PublishRow {
  tenant_id: string;
  publish_request_id: string;
  credential_id: string;
  credential_lifecycle_status_at_request: 'ISSUED';
  consent_ref: string;
  purpose_code: string;
  connector_binding_id: string;
  connector_mode: 'REAL' | 'SANDBOX' | 'SIMULATED';
  simulation_marker: unknown | null;
  document_type_ref: string;
  publish_status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'RETRY_SCHEDULED';
  provider_transaction_ref: string | null;
  failure_code: string | null;
  attempt_number: number;
  idempotency_key: string;
  issuance_reversed_on_publish_failure: false;
  registry_status_changed_by_publish: false;
  invented_statutory_policy_forbidden: true;
  correlation_id: string;
  actor_type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface IdempotencyRecord {
  tenant_id: string;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_ref: string | null;
  response_status: number | null;
  response_body: unknown | null;
  created_at: string;
  expires_at: string;
}

export interface DigilockerTx {
  insertPublishRecord(row: PublishRow): Promise<void>;
  updatePublishRecord(
    tenantId: string,
    publishRequestId: string,
    patch: Pick<
      PublishRow,
      'publish_status' | 'provider_transaction_ref' | 'failure_code' | 'attempt_number'
    >,
  ): Promise<boolean>;
  getPublishRecord(tenantId: string, publishRequestId: string): Promise<PublishRow | null>;
  insertOutbox(envelope: unknown, topic: string): Promise<void>;
  claimIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<IdempotencyRecord | 'claimed'>;
  peekIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyRecord | null>;
  completeIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
}

export interface DigilockerRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: TenantContext, fn: (tx: DigilockerTx) => Promise<T>): Promise<T>;
}
