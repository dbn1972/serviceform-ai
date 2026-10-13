import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp006Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';
import type {
  DiscoveryQueryRecord,
  DiscoveryRepository,
  DiscoveryResultRecord,
  DiscoverySelectionRecord,
  DiscoveryTx,
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
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toQuery(r: Record<string, unknown>): DiscoveryQueryRecord {
  return {
    tenant_id: String(r['tenant_id']),
    query_id: String(r['query_id']),
    actor_type: r['actor_type'] as ActorType,
    actor_id: String(r['actor_id']),
    catalogue_version_id: String(r['catalogue_version_id']),
    jurisdiction_codes: strArray(r['jurisdiction_codes']),
    service_codes: strArray(r['service_codes']),
    keyword_count: Number(r['keyword_count']),
    pagination_limit: Number(r['pagination_limit']),
    pagination_offset: Number(r['pagination_offset']),
    result_count: Number(r['result_count']),
    excluded_count: Number(r['excluded_count']),
    has_more: r['has_more'] === true,
    created_at: iso(r['created_at']),
    correlation_id: String(r['correlation_id']),
  };
}

function toResult(r: Record<string, unknown>): DiscoveryResultRecord {
  return {
    tenant_id: String(r['tenant_id']),
    query_id: String(r['query_id']),
    rank: Number(r['rank']),
    service_id: String(r['service_id']),
    service_code: String(r['service_code']),
    category_code: strOrNull(r['category_code']),
    service_binding_version_id: String(r['service_binding_version_id']),
    catalogue_version_id: String(r['catalogue_version_id']),
    matched_jurisdiction_codes: strArray(r['matched_jurisdiction_codes']),
  };
}

class PgTx implements DiscoveryTx {
  constructor(
    private readonly c: SqlClient,
    private readonly tenantId: string,
  ) {}

  async claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const expires = new Date(p.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_discovery.idempotency_record (
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
    const existing = await this.c.query<{
      request_fingerprint: string;
      status: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_discovery.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp006Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp006Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp006Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_discovery.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertQuery(row: DiscoveryQueryRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_discovery.discovery_query (
         tenant_id, query_id, actor_type, actor_id, catalogue_version_id, jurisdiction_codes,
         service_codes, keyword_count, pagination_limit, pagination_offset, result_count,
         excluded_count, has_more, created_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.tenant_id,
        row.query_id,
        row.actor_type,
        row.actor_id,
        row.catalogue_version_id,
        row.jurisdiction_codes,
        row.service_codes,
        row.keyword_count,
        row.pagination_limit,
        row.pagination_offset,
        row.result_count,
        row.excluded_count,
        row.has_more,
        row.created_at,
        row.correlation_id,
      ],
    );
  }

  async insertResults(rows: DiscoveryResultRecord[]): Promise<void> {
    for (const row of rows) {
      await this.c.query(
        `INSERT INTO sf_discovery.discovery_result (
           tenant_id, query_id, rank, service_id, service_code, category_code,
           service_binding_version_id, catalogue_version_id, matched_jurisdiction_codes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[])`,
        [
          row.tenant_id,
          row.query_id,
          row.rank,
          row.service_id,
          row.service_code,
          row.category_code,
          row.service_binding_version_id,
          row.catalogue_version_id,
          row.matched_jurisdiction_codes,
        ],
      );
    }
  }

  async getQuery(queryId: string): Promise<DiscoveryQueryRecord | undefined> {
    const res = await this.c.query(
      `SELECT tenant_id, query_id, actor_type, actor_id, catalogue_version_id, jurisdiction_codes,
              service_codes, keyword_count, pagination_limit, pagination_offset, result_count,
              excluded_count, has_more, created_at, correlation_id
         FROM sf_discovery.discovery_query WHERE tenant_id = $1 AND query_id = $2`,
      [this.tenantId, queryId],
    );
    const r = res.rows[0];
    return r ? toQuery(r) : undefined;
  }

  async getResults(queryId: string): Promise<DiscoveryResultRecord[]> {
    const res = await this.c.query(
      `SELECT tenant_id, query_id, rank, service_id, service_code, category_code,
              service_binding_version_id, catalogue_version_id, matched_jurisdiction_codes
         FROM sf_discovery.discovery_result WHERE tenant_id = $1 AND query_id = $2 ORDER BY rank`,
      [this.tenantId, queryId],
    );
    return res.rows.map(toResult);
  }

  async insertSelection(row: DiscoverySelectionRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_discovery.discovery_selection (
         tenant_id, selection_id, query_id, service_id, service_code, service_binding_version_id,
         catalogue_version_id, actor_type, actor_id, selected_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.tenant_id,
        row.selection_id,
        row.query_id,
        row.service_id,
        row.service_code,
        row.service_binding_version_id,
        row.catalogue_version_id,
        row.actor_type,
        row.actor_id,
        row.selected_at,
        row.correlation_id,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_discovery.outbox_event (
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

export class PgDiscoveryRepository implements DiscoveryRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: DiscoveryTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp006Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp006Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
