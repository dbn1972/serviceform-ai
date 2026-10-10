import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { OpsMetric, SourceComponent, ViewCode, ViewStatus } from '../domain/model.js';
import { Cmp046Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  OpsRepository,
  OpsTx,
  RefreshLogRow,
  SnapshotRow,
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

const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toSnapshot(r: Record<string, unknown>): SnapshotRow {
  const metrics = typeof r['metrics'] === 'string' ? JSON.parse(r['metrics']) : r['metrics'];
  return {
    tenant_id: String(r['tenant_id']),
    snapshot_id: String(r['snapshot_id']),
    view_code: r['view_code'] as ViewCode,
    source_component: r['source_component'] as SourceComponent,
    status: r['status'] as ViewStatus,
    metrics: (metrics ?? []) as OpsMetric[],
    source_observed_at: isoOrNull(r['source_observed_at']),
    as_of: isoOrNull(r['as_of']),
    last_attempt_at: iso(r['last_attempt_at']),
    last_error_code: strOrNull(r['last_error_code']),
    snapshot_version: num(r['snapshot_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

const SNAPSHOT_COLS = `tenant_id, snapshot_id, view_code, source_component, status, metrics,
  source_observed_at, as_of, last_attempt_at, last_error_code, snapshot_version, created_at, updated_at`;
const SELECT_SNAPSHOT = `SELECT ${SNAPSHOT_COLS} FROM sf_ops_dashboard.ops_view_snapshot`;

class PgTx implements OpsTx {
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
      `INSERT INTO sf_ops_dashboard.idempotency_record (
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
         FROM sf_ops_dashboard.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp046Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp046Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp046Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_ops_dashboard.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async getSnapshot(viewCode: ViewCode): Promise<SnapshotRow | undefined> {
    const r = await this.c.query(SELECT_SNAPSHOT + ' WHERE tenant_id = $1 AND view_code = $2', [
      this.tenantId,
      viewCode,
    ]);
    const row = r.rows[0];
    return row ? toSnapshot(row) : undefined;
  }

  async getSnapshotForUpdate(viewCode: ViewCode): Promise<SnapshotRow | undefined> {
    const r = await this.c.query(
      SELECT_SNAPSHOT + ' WHERE tenant_id = $1 AND view_code = $2 FOR UPDATE',
      [this.tenantId, viewCode],
    );
    const row = r.rows[0];
    return row ? toSnapshot(row) : undefined;
  }

  async listSnapshots(): Promise<SnapshotRow[]> {
    const r = await this.c.query(SELECT_SNAPSHOT + ' WHERE tenant_id = $1 ORDER BY view_code', [
      this.tenantId,
    ]);
    return r.rows.map(toSnapshot);
  }

  async insertSnapshot(row: SnapshotRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_ops_dashboard.ops_view_snapshot (
         tenant_id, snapshot_id, view_code, source_component, status, metrics, source_observed_at,
         as_of, last_attempt_at, last_error_code, snapshot_version, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.tenant_id,
        row.snapshot_id,
        row.view_code,
        row.source_component,
        row.status,
        JSON.stringify(row.metrics),
        row.source_observed_at,
        row.as_of,
        row.last_attempt_at,
        row.last_error_code,
        row.snapshot_version,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async updateSnapshot(row: SnapshotRow): Promise<void> {
    await this.c.query(
      `UPDATE sf_ops_dashboard.ops_view_snapshot SET
         status = $3, metrics = $4::jsonb, source_observed_at = $5, as_of = $6,
         last_attempt_at = $7, last_error_code = $8, snapshot_version = $9, updated_at = $10
       WHERE tenant_id = $1 AND snapshot_id = $2`,
      [
        row.tenant_id,
        row.snapshot_id,
        row.status,
        JSON.stringify(row.metrics),
        row.source_observed_at,
        row.as_of,
        row.last_attempt_at,
        row.last_error_code,
        row.snapshot_version,
        row.updated_at,
      ],
    );
  }

  async insertRefreshLog(row: RefreshLogRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_ops_dashboard.ops_view_refresh_log (
         tenant_id, refresh_id, view_code, outcome, error_code, resulting_status,
         attempted_at, actor_id, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.tenant_id,
        row.refresh_id,
        row.view_code,
        row.outcome,
        row.error_code,
        row.resulting_status,
        row.attempted_at,
        row.actor_id,
        row.correlation_id,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_ops_dashboard.outbox_event (
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

export class PgOpsRepository implements OpsRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: OpsTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp046Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp046Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
