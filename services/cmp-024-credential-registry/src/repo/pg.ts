import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { RegistryEntryRecord, RegistryStatus, StatusHistoryRecord } from '../domain/status.js';
import { Cmp024Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { Actor, EventEnvelope, RequestContext } from '../types.js';
import type { RegistryReadTx, RegistryRepository, RegistryTx, StoredIdempotent } from './types.js';

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

function toEntry(r: Record<string, unknown>): RegistryEntryRecord {
  return {
    tenant_id: String(r['tenant_id']),
    credential_id: String(r['credential_id']),
    issuer_ref: String(r['issuer_ref']),
    current_status: r['current_status'] as RegistryStatus,
    superseded_by_credential_id: strOrNull(r['superseded_by_credential_id']),
    status_version: Number(r['status_version']),
    registered_at: iso(r['registered_at']),
    updated_at: iso(r['updated_at']),
    registered_by: String(r['registered_by']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toHistory(r: Record<string, unknown>): StatusHistoryRecord {
  return {
    tenant_id: String(r['tenant_id']),
    entry_id: String(r['entry_id']),
    credential_id: String(r['credential_id']),
    sequence: Number(r['sequence']),
    from_status: strOrNull(r['from_status']) as RegistryStatus | null,
    to_status: r['to_status'] as RegistryStatus,
    reason_code_ref: strOrNull(r['reason_code_ref']),
    superseded_by_credential_id: strOrNull(r['superseded_by_credential_id']),
    actor_type: r['actor_type'] as Actor['type'],
    actor_id: String(r['actor_id']),
    correlation_id: String(r['correlation_id']),
    changed_at: iso(r['changed_at']),
  };
}

const SELECT_ENTRY = `SELECT tenant_id, credential_id, issuer_ref, current_status,
         superseded_by_credential_id, status_version, registered_at, updated_at, registered_by,
         last_correlation_id
    FROM sf_credential_registry.credential_registry_entry WHERE tenant_id = $1 AND credential_id = $2`;
const SELECT_ENTRY_FOR_UPDATE = `SELECT tenant_id, credential_id, issuer_ref, current_status,
         superseded_by_credential_id, status_version, registered_at, updated_at, registered_by,
         last_correlation_id
    FROM sf_credential_registry.credential_registry_entry WHERE tenant_id = $1 AND credential_id = $2
     FOR UPDATE`;
const SELECT_HISTORY = `SELECT tenant_id, entry_id, credential_id, sequence, from_status, to_status,
         reason_code_ref, superseded_by_credential_id, actor_type, actor_id, correlation_id, changed_at
    FROM sf_credential_registry.credential_status_history
   WHERE tenant_id = $1 AND credential_id = $2 ORDER BY sequence`;

class PgReadTx implements RegistryReadTx {
  constructor(
    protected readonly c: SqlClient,
    protected readonly tenantId: string,
  ) {}

  async getEntry(credentialId: string): Promise<RegistryEntryRecord | undefined> {
    const res = await this.c.query(SELECT_ENTRY, [this.tenantId, credentialId]);
    const r = res.rows[0];
    return r ? toEntry(r) : undefined;
  }

  async listHistory(credentialId: string): Promise<StatusHistoryRecord[]> {
    const res = await this.c.query(SELECT_HISTORY, [this.tenantId, credentialId]);
    return res.rows.map(toHistory);
  }
}

class PgTx extends PgReadTx implements RegistryTx {
  async getEntryForUpdate(credentialId: string): Promise<RegistryEntryRecord | undefined> {
    const res = await this.c.query(SELECT_ENTRY_FOR_UPDATE, [this.tenantId, credentialId]);
    const r = res.rows[0];
    return r ? toEntry(r) : undefined;
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
      `INSERT INTO sf_credential_registry.idempotency_record (
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
         FROM sf_credential_registry.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp024Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp024Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp024Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_credential_registry.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertEntry(row: RegistryEntryRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_credential_registry.credential_registry_entry (
         tenant_id, credential_id, issuer_ref, current_status, superseded_by_credential_id,
         status_version, registered_at, updated_at, registered_by, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.tenant_id,
        row.credential_id,
        row.issuer_ref,
        row.current_status,
        row.superseded_by_credential_id,
        row.status_version,
        row.registered_at,
        row.updated_at,
        row.registered_by,
        row.last_correlation_id,
      ],
    );
  }

  async updateEntryStatus(row: RegistryEntryRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_credential_registry.credential_registry_entry
          SET current_status = $3, superseded_by_credential_id = $4, status_version = $5,
              updated_at = $6, last_correlation_id = $7
        WHERE tenant_id = $1 AND credential_id = $2 AND status_version = $5 - 1`,
      [
        this.tenantId,
        row.credential_id,
        row.current_status,
        row.superseded_by_credential_id,
        row.status_version,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp024Error('SF-APP-001');
  }

  async insertHistory(row: StatusHistoryRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_credential_registry.credential_status_history (
         tenant_id, entry_id, credential_id, sequence, from_status, to_status, reason_code_ref,
         superseded_by_credential_id, actor_type, actor_id, correlation_id, changed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.tenant_id,
        row.entry_id,
        row.credential_id,
        row.sequence,
        row.from_status,
        row.to_status,
        row.reason_code_ref,
        row.superseded_by_credential_id,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
        row.changed_at,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_credential_registry.outbox_event (
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

export class PgRegistryRepository implements RegistryRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  withTx<T>(ctx: RequestContext, fn: (tx: RegistryTx) => Promise<T>): Promise<T> {
    return this.run(ctx, 'BEGIN', (c, tenantId) => fn(new PgTx(c, tenantId)));
  }

  /** READ ONLY at the database: any write attempted by a read port fails with 25006. */
  withReadTx<T>(ctx: RequestContext, fn: (tx: RegistryReadTx) => Promise<T>): Promise<T> {
    return this.run(ctx, 'BEGIN READ ONLY', (c, tenantId) => fn(new PgReadTx(c, tenantId)));
  }

  private async run<T>(
    ctx: RequestContext,
    begin: 'BEGIN' | 'BEGIN READ ONLY',
    fn: (c: SqlClient, tenantId: string) => Promise<T>,
  ): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp024Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp024Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const client = await this.pool.connect();
    try {
      await client.query(begin);
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
      const result = await this.als.run(true, () => fn(client, tenantId));
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
