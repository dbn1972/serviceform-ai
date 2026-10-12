import type {
  ActorType,
  EventEnvelope,
  RequestContext,
  ConnectorMode,
  PaymentStatus,
} from '../types.js';

export interface IntentRow {
  tenant_id: string;
  payment_intent_id: string;
  fee_quote_id: string;
  application_id: string;
  cell_id: string;
  currency: string;
  amount_minor: bigint;
  status: PaymentStatus;
  connector_binding_id: string;
  connector_mode: ConnectorMode;
  simulation_marker: Record<string, unknown> | null;
  psp_session_ref: string | null;
  psp_redirect_url: string | null;
  idempotency_key: string;
  correlation_id: string;
  actor_type: ActorType;
  created_by: string;
  created_at: string;
}

export interface CallbackRow {
  tenant_id: string;
  callback_id: string;
  payment_intent_id: string;
  application_id: string;
  exactly_once_key: string;
  verification_result: 'VERIFIED' | 'REJECTED';
  signature_verified: boolean;
  financial_effect_applied: boolean;
  idempotency_key: string;
  correlation_id: string;
  recorded_at: string;
}

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface IdempotencyPeek {
  request_fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_status: number | null;
  response_body: unknown;
}

export interface PaymentTx {
  peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined>;
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

  insertIntent(row: IntentRow): Promise<boolean>;
  getIntent(paymentIntentId: string): Promise<IntentRow | undefined>;
  updateIntentStatus(paymentIntentId: string, status: PaymentStatus): Promise<void>;

  insertCallback(row: CallbackRow): Promise<void>;
  getCallbackByExactlyOnceKey(exactlyOnceKey: string): Promise<CallbackRow | undefined>;

  /** Claim exactly-once financial effect; returns true when this call claimed it, false if already claimed. */
  claimExactlyOnceEffect(
    tenantId: string,
    exactlyOnceKey: string,
    callbackId: string,
  ): Promise<boolean>;

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface PaymentRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: PaymentTx) => Promise<T>): Promise<T>;
}
