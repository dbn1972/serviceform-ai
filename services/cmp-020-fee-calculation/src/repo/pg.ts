import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp020Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  FeeRepository,
  FeeTx,
  IdempotencyPeek,
  LineRow,
  QuoteRow,
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
/** bigint columns arrive from pg as decimal strings; BigInt keeps them exact. */
const minor = (v: unknown): bigint => BigInt(String(v));

const QUOTE_COLS = `tenant_id, quote_id, application_id, cell_id, tenant_service_binding_id,
  fee_policy_version_id, fee_policy_content_hash, rule_version_id, rule_content_hash,
  rule_evaluation_id, currency, total_amount_minor, amount_source, waiver_policy_ref, facts_hash,
  calculation_hash, idempotency_key, correlation_id, actor_type, issued_by, issued_at`;
const SELECT_QUOTE = `SELECT ${QUOTE_COLS} FROM sf_fee.fee_quote`;

function toQuote(r: Record<string, unknown>): QuoteRow {
  return {
    tenant_id: String(r['tenant_id']),
    quote_id: String(r['quote_id']),
    application_id: String(r['application_id']),
    cell_id: String(r['cell_id']),
    tenant_service_binding_id: String(r['tenant_service_binding_id']),
    fee_policy_version_id: String(r['fee_policy_version_id']),
    fee_policy_content_hash: String(r['fee_policy_content_hash']),
    rule_version_id: String(r['rule_version_id']),
    rule_content_hash: strOrNull(r['rule_content_hash']),
    rule_evaluation_id: strOrNull(r['rule_evaluation_id']),
    currency: String(r['currency']),
    total_amount_minor: minor(r['total_amount_minor']),
    amount_source: r['amount_source'] as QuoteRow['amount_source'],
    waiver_policy_ref: strOrNull(r['waiver_policy_ref']),
    facts_hash: String(r['facts_hash']),
    calculation_hash: String(r['calculation_hash']),
    idempotency_key: String(r['idempotency_key']),
    correlation_id: String(r['correlation_id']),
    actor_type: r['actor_type'] as QuoteRow['actor_type'],
    issued_by: String(r['issued_by']),
    issued_at: iso(r['issued_at']),
  };
}

function toLine(r: Record<string, unknown>): LineRow {
  return {
    quote_id: String(r['quote_id']),
    line_seq: Number(r['line_seq']),
    code: String(r['code']),
    amount_minor: minor(r['amount_minor']),
    calculation_basis: r['calculation_basis'] as LineRow['calculation_basis'],
    description_code: strOrNull(r['description_code']),
    rule_output_key: strOrNull(r['rule_output_key']),
  };
}

class PgTx implements FeeTx {
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
         FROM sf_fee.idempotency_record
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
      `INSERT INTO sf_fee.idempotency_record (
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
    if (!row) throw new Cmp020Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp020Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp020Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_fee.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertQuote(row: QuoteRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_fee.fee_quote (
         tenant_id, quote_id, application_id, cell_id, tenant_service_binding_id,
         fee_policy_version_id, fee_policy_content_hash, rule_version_id, rule_content_hash,
         rule_evaluation_id, currency, total_amount_minor, amount_source, waiver_policy_ref,
         facts_hash, calculation_hash, idempotency_key, correlation_id, actor_type, issued_by,
         issued_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::bigint,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (tenant_id, application_id, calculation_hash) DO NOTHING`,
      [
        row.tenant_id,
        row.quote_id,
        row.application_id,
        row.cell_id,
        row.tenant_service_binding_id,
        row.fee_policy_version_id,
        row.fee_policy_content_hash,
        row.rule_version_id,
        row.rule_content_hash,
        row.rule_evaluation_id,
        row.currency,
        row.total_amount_minor.toString(),
        row.amount_source,
        row.waiver_policy_ref,
        row.facts_hash,
        row.calculation_hash,
        row.idempotency_key,
        row.correlation_id,
        row.actor_type,
        row.issued_by,
        row.issued_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertLine(row: LineRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_fee.fee_quote_line (
         tenant_id, quote_id, line_seq, code, amount_minor, calculation_basis, description_code,
         rule_output_key
       ) VALUES ($1,$2,$3,$4,$5::bigint,$6,$7,$8)`,
      [
        this.tenantId,
        row.quote_id,
        row.line_seq,
        row.code,
        row.amount_minor.toString(),
        row.calculation_basis,
        row.description_code,
        row.rule_output_key,
      ],
    );
  }

  async getQuote(quoteId: string): Promise<QuoteRow | undefined> {
    const r = await this.c.query(SELECT_QUOTE + ' WHERE tenant_id = $1 AND quote_id = $2', [
      this.tenantId,
      quoteId,
    ]);
    const row = r.rows[0];
    return row ? toQuote(row) : undefined;
  }

  async findQuoteByCalculation(
    applicationId: string,
    calculationHash: string,
  ): Promise<QuoteRow | undefined> {
    const r = await this.c.query(
      SELECT_QUOTE + ' WHERE tenant_id = $1 AND application_id = $2 AND calculation_hash = $3',
      [this.tenantId, applicationId, calculationHash],
    );
    const row = r.rows[0];
    return row ? toQuote(row) : undefined;
  }

  async listLines(quoteId: string): Promise<LineRow[]> {
    const r = await this.c.query(
      `SELECT quote_id, line_seq, code, amount_minor::text AS amount_minor, calculation_basis,
              description_code, rule_output_key
         FROM sf_fee.fee_quote_line
        WHERE tenant_id = $1 AND quote_id = $2 ORDER BY line_seq`,
      [this.tenantId, quoteId],
    );
    return r.rows.map(toLine);
  }

  async listByApplication(applicationId: string): Promise<QuoteRow[]> {
    const r = await this.c.query(
      SELECT_QUOTE + ' WHERE tenant_id = $1 AND application_id = $2 ORDER BY issued_at, quote_id',
      [this.tenantId, applicationId],
    );
    return r.rows.map(toQuote);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_fee.outbox_event (
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

export class PgFeeRepository implements FeeRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: FeeTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp020Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp020Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
