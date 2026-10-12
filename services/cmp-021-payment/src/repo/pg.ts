import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp021Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext, PaymentStatus } from '../types.js';
import type {
  CallbackRow,
  IdempotencyPeek,
  IntentRow,
  PaymentRepository,
  PaymentTx,
  StoredIdempotent,
} from './types.js';

export interface SqlResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<R>>;
  release(): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const minor = (v: unknown): bigint => BigInt(String(v));
const bool = (v: unknown): boolean => v === true || v === 't' || v === '1' || v === 'true';

class PgTx implements PaymentTx {
  constructor(
    private readonly c: SqlClient,
    private readonly tenantId: string,
  ) {}

  async peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined> {
    const r = await this.c.query<{
      request_fingerprint: string;
      status: IdempotencyPeek['status'];
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_payment.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    return r.rows[0];
  }

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const expires = new Date(p.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_payment.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        p.principalId,
        p.endpoint,
        p.key,
        p.fingerprint,
        p.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const row = await this.peekIdempotency(p);
    if (!row) throw new Cmp021Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp021Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp021Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_payment.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertIntent(row: IntentRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_payment.payment_intent (
         tenant_id, payment_intent_id, fee_quote_id, application_id, cell_id,
         currency, amount_minor, status, connector_binding_id, connector_mode,
         simulation_marker, psp_session_ref, psp_redirect_url,
         idempotency_key, correlation_id, actor_type, created_by, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (tenant_id, payment_intent_id) DO NOTHING`,
      [
        row.tenant_id,
        row.payment_intent_id,
        row.fee_quote_id,
        row.application_id,
        row.cell_id,
        row.currency,
        row.amount_minor.toString(),
        row.status,
        row.connector_binding_id,
        row.connector_mode,
        row.simulation_marker ? JSON.stringify(row.simulation_marker) : null,
        row.psp_session_ref,
        row.psp_redirect_url,
        row.idempotency_key,
        row.correlation_id,
        row.actor_type,
        row.created_by,
        row.created_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async getIntent(paymentIntentId: string): Promise<IntentRow | undefined> {
    const r = await this.c.query(
      `SELECT tenant_id, payment_intent_id, fee_quote_id, application_id, cell_id,
              currency, amount_minor::text AS amount_minor, status,
              connector_binding_id, connector_mode, simulation_marker,
              psp_session_ref, psp_redirect_url,
              idempotency_key, correlation_id, actor_type, created_by, created_at
         FROM sf_payment.payment_intent
        WHERE tenant_id = $1 AND payment_intent_id = $2`,
      [this.tenantId, paymentIntentId],
    );
    const row = r.rows[0];
    return row ? toIntent(row) : undefined;
  }

  async updateIntentStatus(paymentIntentId: string, status: PaymentStatus): Promise<void> {
    await this.c.query(
      `UPDATE sf_payment.payment_intent SET status = $3
        WHERE tenant_id = $1 AND payment_intent_id = $2`,
      [this.tenantId, paymentIntentId, status],
    );
  }

  async insertCallback(row: CallbackRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_payment.payment_callback (
         tenant_id, callback_id, payment_intent_id, application_id,
         exactly_once_key, verification_result, signature_verified, financial_effect_applied,
         idempotency_key, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.tenant_id,
        row.callback_id,
        row.payment_intent_id,
        row.application_id,
        row.exactly_once_key,
        row.verification_result,
        row.signature_verified,
        row.financial_effect_applied,
        row.idempotency_key,
        row.correlation_id,
      ],
    );
  }

  async getCallbackByExactlyOnceKey(exactlyOnceKey: string): Promise<CallbackRow | undefined> {
    const r = await this.c.query(
      `SELECT tenant_id, callback_id, payment_intent_id, application_id,
              exactly_once_key, verification_result, signature_verified, financial_effect_applied,
              idempotency_key, correlation_id, recorded_at
         FROM sf_payment.payment_callback
        WHERE tenant_id = $1 AND exactly_once_key = $2`,
      [this.tenantId, exactlyOnceKey],
    );
    const row = r.rows[0];
    return row ? toCallback(row) : undefined;
  }

  async claimExactlyOnceEffect(
    tenantId: string,
    exactlyOnceKey: string,
    callbackId: string,
  ): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_payment.exactly_once_effect (tenant_id, exactly_once_key, callback_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, exactly_once_key) DO NOTHING`,
      [tenantId, exactlyOnceKey, callbackId],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_payment.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        topic,
        topic === TOPIC_AUDIT
          ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
          : envelope.aggregate_id,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(envelope),
      ],
    );
  }
}

function toIntent(r: Record<string, unknown>): IntentRow {
  return {
    tenant_id: String(r['tenant_id']),
    payment_intent_id: String(r['payment_intent_id']),
    fee_quote_id: String(r['fee_quote_id']),
    application_id: String(r['application_id']),
    cell_id: String(r['cell_id']),
    currency: String(r['currency']),
    amount_minor: minor(r['amount_minor']),
    status: r['status'] as IntentRow['status'],
    connector_binding_id: String(r['connector_binding_id']),
    connector_mode: r['connector_mode'] as IntentRow['connector_mode'],
    simulation_marker: (r['simulation_marker'] as Record<string, unknown> | null) ?? null,
    psp_session_ref: strOrNull(r['psp_session_ref']),
    psp_redirect_url: strOrNull(r['psp_redirect_url']),
    idempotency_key: String(r['idempotency_key']),
    correlation_id: String(r['correlation_id']),
    actor_type: r['actor_type'] as IntentRow['actor_type'],
    created_by: String(r['created_by']),
    created_at: iso(r['created_at']),
  };
}

function toCallback(r: Record<string, unknown>): CallbackRow {
  return {
    tenant_id: String(r['tenant_id']),
    callback_id: String(r['callback_id']),
    payment_intent_id: String(r['payment_intent_id']),
    application_id: String(r['application_id']),
    exactly_once_key: String(r['exactly_once_key']),
    verification_result: r['verification_result'] as CallbackRow['verification_result'],
    signature_verified: bool(r['signature_verified']),
    financial_effect_applied: bool(r['financial_effect_applied']),
    idempotency_key: String(r['idempotency_key']),
    correlation_id: String(r['correlation_id']),
    recorded_at: iso(r['recorded_at']),
  };
}

export class PgPaymentRepository implements PaymentRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: PaymentTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp021Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp021Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', tenantId],
        ['app.cell_id', ctx.cell_id],
        ['app.actor_type', ctx.actor.type],
        ['app.actor_id', ctx.actor.id],
        ['app.correlation_id', ctx.correlation_id],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await this.als.run(true, () => fn(new PgTx(client, tenantId)));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep original
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
