import type { AmountSource, CalculationBasis } from '../domain/calculate.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';

export interface QuoteRow {
  tenant_id: string;
  quote_id: string;
  application_id: string;
  cell_id: string;
  tenant_service_binding_id: string;
  fee_policy_version_id: string;
  fee_policy_content_hash: string;
  rule_version_id: string;
  rule_content_hash: string | null;
  rule_evaluation_id: string | null;
  currency: string;
  total_amount_minor: bigint;
  amount_source: AmountSource;
  waiver_policy_ref: string | null;
  facts_hash: string;
  calculation_hash: string;
  idempotency_key: string;
  correlation_id: string;
  actor_type: ActorType;
  issued_by: string;
  issued_at: string;
}

export interface LineRow {
  quote_id: string;
  line_seq: number;
  code: string;
  amount_minor: bigint;
  calculation_basis: CalculationBasis;
  description_code: string | null;
  rule_output_key: string | null;
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

export interface FeeTx {
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
  /** Returns false when an identical calculation already exists for the application. */
  insertQuote(row: QuoteRow): Promise<boolean>;
  insertLine(row: LineRow): Promise<void>;
  getQuote(quoteId: string): Promise<QuoteRow | undefined>;
  findQuoteByCalculation(
    applicationId: string,
    calculationHash: string,
  ): Promise<QuoteRow | undefined>;
  listLines(quoteId: string): Promise<LineRow[]>;
  listByApplication(applicationId: string): Promise<QuoteRow[]>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

export interface FeeRepository {
  inTransaction(): boolean;
  withTx<T>(ctx: RequestContext, fn: (tx: FeeTx) => Promise<T>): Promise<T>;
}
