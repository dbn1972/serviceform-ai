import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp012Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, TenantContext } from '../types.js';
import type { DigilockerRepository, DigilockerTx, IdempotencyRecord, PublishRow } from './types.js';

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

/** Matches the memory double: a claimed idempotency record lives for 24h. */
export const IDEMPOTENCY_TTL_MS = 86_400_000;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const PUBLISH_COLS = `tenant_id, publish_request_id, credential_id,
  credential_lifecycle_status_at_request, consent_ref, purpose_code, connector_binding_id,
  connector_mode, simulation_marker, document_type_ref, publish_status, provider_transaction_ref,
  failure_code, attempt_number, idempotency_key, issuance_reversed_on_publish_failure,
  registry_status_changed_by_publish, invented_statutory_policy_forbidden, correlation_id,
  actor_type, created_by, created_at, updated_at`;
const SELECT_PUBLISH = `SELECT ${PUBLISH_COLS} FROM sf_digilocker.publish_record`;
const INSERT_PUBLISH = `INSERT INTO sf_digilocker.publish_record (${PUBLISH_COLS})
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`;

const IDEMPOTENCY_COLS = `tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint,
  status, response_ref, response_status, response_body, created_at, expires_at`;
const SELECT_IDEMPOTENCY = `SELECT ${IDEMPOTENCY_COLS} FROM sf_digilocker.idempotency_record
  WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`;

export function toPublishRow(r: Record<string, unknown>): PublishRow {
  return {
    tenant_id: String(r['tenant_id']),
    publish_request_id: String(r['publish_request_id']),
    credential_id: String(r['credential_id']),
    credential_lifecycle_status_at_request: 'ISSUED',
    consent_ref: String(r['consent_ref']),
    purpose_code: String(r['purpose_code']),
    connector_binding_id: String(r['connector_binding_id']),
    connector_mode: r['connector_mode'] as PublishRow['connector_mode'],
    simulation_marker: r['simulation_marker'] ?? null,
    document_type_ref: String(r['document_type_ref']),
    publish_status: r['publish_status'] as PublishRow['publish_status'],
    provider_transaction_ref: strOrNull(r['provider_transaction_ref']),
    failure_code: strOrNull(r['failure_code']),
    attempt_number: Number(r['attempt_number']),
    idempotency_key: String(r['idempotency_key']),
    issuance_reversed_on_publish_failure: false,
    registry_status_changed_by_publish: false,
    invented_statutory_policy_forbidden: true,
    correlation_id: String(r['correlation_id']),
    actor_type: String(r['actor_type']),
    created_by: String(r['created_by']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

export function toIdempotencyRecord(r: Record<string, unknown>): IdempotencyRecord {
  return {
    tenant_id: String(r['tenant_id']),
    principal_id: String(r['principal_id']),
    endpoint: String(r['endpoint']),
    idempotency_key: String(r['idempotency_key']),
    request_fingerprint: String(r['request_fingerprint']),
    status: r['status'] as IdempotencyRecord['status'],
    response_ref: strOrNull(r['response_ref']),
    response_status: numOrNull(r['response_status']),
    response_body: r['response_body'] ?? null,
    created_at: iso(r['created_at']),
    expires_at: iso(r['expires_at']),
  };
}

/** Audit envelopes are keyed by audit_id so per-record ordering never blocks on an aggregate. */
export function outboxPartitionKey(envelope: EventEnvelope<object>, topic: string): string {
  if (topic === TOPIC_AUDIT) {
    const auditId = (envelope.data as { audit_id?: unknown }).audit_id;
    return `audit:${typeof auditId === 'string' ? auditId : envelope.aggregate_id}`;
  }
  return envelope.aggregate_id;
}

class PgTx implements DigilockerTx {
  constructor(
    private readonly c: SqlClient,
    private readonly tenantId: string,
  ) {}

  private assertTenant(tenantId: string): void {
    if (tenantId !== this.tenantId) throw new Cmp012Error('SF-TEN-002');
  }

  async insertPublishRecord(row: PublishRow): Promise<void> {
    this.assertTenant(row.tenant_id);
    await this.c.query(INSERT_PUBLISH, [
      row.tenant_id,
      row.publish_request_id,
      row.credential_id,
      row.credential_lifecycle_status_at_request,
      row.consent_ref,
      row.purpose_code,
      row.connector_binding_id,
      row.connector_mode,
      row.simulation_marker === null ? null : JSON.stringify(row.simulation_marker),
      row.document_type_ref,
      row.publish_status,
      row.provider_transaction_ref,
      row.failure_code,
      row.attempt_number,
      row.idempotency_key,
      row.issuance_reversed_on_publish_failure,
      row.registry_status_changed_by_publish,
      row.invented_statutory_policy_forbidden,
      row.correlation_id,
      row.actor_type,
      row.created_by,
      row.created_at,
      row.updated_at,
    ]);
  }

  async updatePublishRecord(
    tenantId: string,
    publishRequestId: string,
    patch: Pick<
      PublishRow,
      'publish_status' | 'provider_transaction_ref' | 'failure_code' | 'attempt_number'
    >,
  ): Promise<boolean> {
    this.assertTenant(tenantId);
    const r = await this.c.query(
      `UPDATE sf_digilocker.publish_record
          SET publish_status = $3, provider_transaction_ref = $4, failure_code = $5,
              attempt_number = $6, updated_at = now()
        WHERE tenant_id = $1 AND publish_request_id = $2`,
      [
        tenantId,
        publishRequestId,
        patch.publish_status,
        patch.provider_transaction_ref,
        patch.failure_code,
        patch.attempt_number,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async getPublishRecord(tenantId: string, publishRequestId: string): Promise<PublishRow | null> {
    this.assertTenant(tenantId);
    const r = await this.c.query(
      SELECT_PUBLISH + ' WHERE tenant_id = $1 AND publish_request_id = $2',
      [tenantId, publishRequestId],
    );
    return r.rows[0] ? toPublishRow(r.rows[0]) : null;
  }

  async listPublishRecordsForCredential(
    tenantId: string,
    credentialId: string,
  ): Promise<PublishRow[]> {
    this.assertTenant(tenantId);
    const r = await this.c.query(
      SELECT_PUBLISH +
        ' WHERE tenant_id = $1 AND credential_id = $2' +
        ' ORDER BY created_at DESC, publish_request_id DESC LIMIT 50',
      [tenantId, credentialId],
    );
    return r.rows.map((row) => toPublishRow(row));
  }

  async insertOutbox(envelope: unknown, topic: string): Promise<void> {
    const env = envelope as EventEnvelope<object>;
    const partitionKey = outboxPartitionKey(env, topic);
    if (env.tenant_id === null) {
      await this.c.query(
        `INSERT INTO sf_digilocker.outbox_event_platform (
           event_id, topic, partition_key, event_type, schema_version, aggregate_type,
           aggregate_id, aggregate_version, envelope
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          env.event_id,
          topic,
          partitionKey,
          env.event_type,
          env.schema_version,
          env.aggregate_type,
          env.aggregate_id,
          env.aggregate_version,
          JSON.stringify(env),
        ],
      );
      return;
    }
    this.assertTenant(env.tenant_id);
    await this.c.query(
      `INSERT INTO sf_digilocker.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        env.event_id,
        env.tenant_id,
        topic,
        partitionKey,
        env.event_type,
        env.schema_version,
        env.aggregate_type,
        env.aggregate_id,
        env.aggregate_version,
        JSON.stringify(env),
      ],
    );
  }

  async claimIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<IdempotencyRecord | 'claimed'> {
    const expires = new Date(opts.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.c.query(
      `INSERT INTO sf_digilocker.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status,
         created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        opts.principalId,
        opts.endpoint,
        opts.key,
        opts.fingerprint,
        opts.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const existing = await this.peekIdempotency(opts);
    if (!existing) throw new Cmp012Error('SF-SYS-001');
    return existing;
  }

  async peekIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyRecord | null> {
    const r = await this.c.query(SELECT_IDEMPOTENCY, [
      this.tenantId,
      opts.principalId,
      opts.endpoint,
      opts.key,
    ]);
    return r.rows[0] ? toIdempotencyRecord(r.rows[0]) : null;
  }

  async completeIdempotency(opts: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_digilocker.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [
        this.tenantId,
        opts.principalId,
        opts.endpoint,
        opts.key,
        opts.status,
        JSON.stringify(opts.body ?? null),
      ],
    );
  }
}

export class PgDigilockerRepository implements DigilockerRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: TenantContext, fn: (tx: DigilockerTx) => Promise<T>): Promise<T> {
    const tenantId = (ctx as { tenant_id: string | null }).tenant_id;
    if (tenantId === null || tenantId === '') throw new Cmp012Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp012Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
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
