import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp025Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { Channel } from '../domain/model.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  AttemptRow,
  DispatchRow,
  NotificationRepository,
  NotificationTx,
  StoredIdempotent,
  TemplateRow,
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

function toTemplate(r: Record<string, unknown>): TemplateRow {
  return {
    template_ref: String(r['template_ref']),
    template_version: num(r['template_version']),
    channel: r['channel'] as Channel,
    locale: String(r['locale']),
    subject_template: strOrNull(r['subject_template']),
    body_template: String(r['body_template']),
    allowed_params: (r['allowed_params'] as string[] | null) ?? [],
    published_by: String(r['published_by']),
    published_at: iso(r['published_at']),
    correlation_id: String(r['correlation_id']),
  };
}

function toDispatch(r: Record<string, unknown>): DispatchRow {
  return {
    tenant_id: String(r['tenant_id']),
    dispatch_id: String(r['dispatch_id']),
    application_id: strOrNull(r['application_id']),
    cell_id: String(r['cell_id']),
    template_ref: String(r['template_ref']),
    template_version: num(r['template_version']),
    channel: r['channel'] as DispatchRow['channel'],
    locale: String(r['locale']),
    recipient_handle_class: r['recipient_handle_class'] as DispatchRow['recipient_handle_class'],
    recipient_handle_ref: String(r['recipient_handle_ref']),
    template_params: (r['template_params'] as Record<string, string>) ?? {},
    connector_binding_id: String(r['connector_binding_id']),
    connector_mode: r['connector_mode'] as DispatchRow['connector_mode'],
    connector_environment: r['connector_environment'] as DispatchRow['connector_environment'],
    connector_critical: Boolean(r['connector_critical']),
    simulation_marker: (r['simulation_marker'] as DispatchRow['simulation_marker']) ?? null,
    status: r['status'] as DispatchRow['status'],
    attempts: num(r['attempts']),
    max_attempts: num(r['max_attempts']),
    next_attempt_at: iso(r['next_attempt_at']),
    lease_owner: strOrNull(r['lease_owner']),
    lease_expires_at: isoOrNull(r['lease_expires_at']),
    provider_message_ref: strOrNull(r['provider_message_ref']),
    last_error_code: strOrNull(r['last_error_code']),
    idempotency_key: String(r['idempotency_key']),
    requested_by: String(r['requested_by']),
    requested_at: iso(r['requested_at']),
    sent_at: isoOrNull(r['sent_at']),
    delivered_at: isoOrNull(r['delivered_at']),
    correlation_id: String(r['correlation_id']),
    aggregate_version: num(r['aggregate_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

function toAttempt(r: Record<string, unknown>): AttemptRow {
  return {
    dispatch_id: String(r['dispatch_id']),
    attempt_no: num(r['attempt_no']),
    outcome: r['outcome'] as AttemptRow['outcome'],
    error_code: strOrNull(r['error_code']),
    provider_message_ref: strOrNull(r['provider_message_ref']),
    connector_mode: r['connector_mode'] as AttemptRow['connector_mode'],
    simulation_marker: (r['simulation_marker'] as AttemptRow['simulation_marker']) ?? null,
    occurred_at: iso(r['occurred_at']),
    correlation_id: String(r['correlation_id']),
  };
}

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

class PgTx implements NotificationTx {
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
      `INSERT INTO sf_notification.idempotency_record (
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
         FROM sf_notification.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp025Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp025Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp025Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_notification.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertTemplate(row: TemplateRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_notification.notification_template (
         tenant_id, template_ref, template_version, channel, locale, subject_template, body_template,
         allowed_params, published_by, published_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11)`,
      [
        this.tenantId,
        row.template_ref,
        row.template_version,
        row.channel,
        row.locale,
        row.subject_template,
        row.body_template,
        row.allowed_params,
        row.published_by,
        row.published_at,
        row.correlation_id,
      ],
    );
  }

  async getTemplate(
    ref: string,
    channel: Channel,
    locale: string,
    version?: number,
  ): Promise<TemplateRow | undefined> {
    const r = await this.c.query(
      `SELECT template_ref, template_version, channel, locale, subject_template, body_template,
              allowed_params, published_by, published_at, correlation_id
         FROM sf_notification.notification_template
        WHERE tenant_id = $1 AND template_ref = $2 AND channel = $3 AND locale = $4
          AND ($5::integer IS NULL OR template_version = $5::integer)
        ORDER BY template_version DESC LIMIT 1`,
      [this.tenantId, ref, channel, locale, version ?? null],
    );
    const row = r.rows[0];
    return row ? toTemplate(row) : undefined;
  }

  async listTemplateVersions(ref: string): Promise<TemplateRow[]> {
    const r = await this.c.query(
      `SELECT template_ref, template_version, channel, locale, subject_template, body_template,
              allowed_params, published_by, published_at, correlation_id
         FROM sf_notification.notification_template
        WHERE tenant_id = $1 AND template_ref = $2
        ORDER BY template_version, channel, locale`,
      [this.tenantId, ref],
    );
    return r.rows.map(toTemplate);
  }

  async insertDispatch(row: DispatchRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_notification.notification_dispatch (
         tenant_id, dispatch_id, application_id, cell_id, template_ref, template_version, channel,
         locale, recipient_handle_class, recipient_handle_ref, template_params, connector_binding_id,
         connector_mode, connector_environment, connector_critical, simulation_marker, status, attempts,
         max_attempts, next_attempt_at, idempotency_key, requested_by, requested_at, correlation_id,
         aggregate_version, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,
                 $21,$22,$23,$24,$25,$26,$27)`,
      [
        this.tenantId,
        row.dispatch_id,
        row.application_id,
        row.cell_id,
        row.template_ref,
        row.template_version,
        row.channel,
        row.locale,
        row.recipient_handle_class,
        row.recipient_handle_ref,
        JSON.stringify(row.template_params),
        row.connector_binding_id,
        row.connector_mode,
        row.connector_environment,
        row.connector_critical,
        json(row.simulation_marker),
        row.status,
        row.attempts,
        row.max_attempts,
        row.next_attempt_at,
        row.idempotency_key,
        row.requested_by,
        row.requested_at,
        row.correlation_id,
        row.aggregate_version,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async getDispatch(dispatchId: string): Promise<DispatchRow | undefined> {
    const r = await this.c.query(
      `SELECT tenant_id, dispatch_id, application_id, cell_id, template_ref, template_version,
  channel, locale, recipient_handle_class, recipient_handle_ref, template_params, connector_binding_id,
  connector_mode, connector_environment, connector_critical, simulation_marker, status, attempts,
  max_attempts, next_attempt_at, lease_owner, lease_expires_at, provider_message_ref, last_error_code,
  idempotency_key, requested_by, requested_at, sent_at, delivered_at, correlation_id, aggregate_version,
  created_at, updated_at
         FROM sf_notification.notification_dispatch
        WHERE tenant_id = $1 AND dispatch_id = $2 FOR UPDATE`,
      [this.tenantId, dispatchId],
    );
    const row = r.rows[0];
    return row ? toDispatch(row) : undefined;
  }

  async updateDispatch(row: DispatchRow): Promise<void> {
    await this.c.query(
      `UPDATE sf_notification.notification_dispatch SET
         status = $3, attempts = $4, next_attempt_at = $5, lease_owner = $6, lease_expires_at = $7,
         provider_message_ref = $8, last_error_code = $9, sent_at = $10, delivered_at = $11,
         aggregate_version = $12, updated_at = $13
       WHERE tenant_id = $1 AND dispatch_id = $2`,
      [
        this.tenantId,
        row.dispatch_id,
        row.status,
        row.attempts,
        row.next_attempt_at,
        row.lease_owner,
        row.lease_expires_at,
        row.provider_message_ref,
        row.last_error_code,
        row.sent_at,
        row.delivered_at,
        row.aggregate_version,
        row.updated_at,
      ],
    );
  }

  async claimDue(p: {
    limit: number;
    now: Date;
    leaseOwner: string;
    leaseMs: number;
  }): Promise<DispatchRow[]> {
    const leaseUntil = new Date(p.now.getTime() + p.leaseMs);
    const r = await this.c.query(
      `WITH due AS (
         SELECT dispatch_id FROM sf_notification.notification_dispatch
          WHERE tenant_id = $1
            AND ((status = 'QUEUED' AND next_attempt_at <= $2)
              OR (status = 'SENDING' AND lease_expires_at <= $2))
          ORDER BY next_attempt_at, dispatch_id
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       )
       UPDATE sf_notification.notification_dispatch d SET
         status = 'SENDING',
         attempts = LEAST(d.attempts + 1, d.max_attempts + 1),
         lease_owner = $4, lease_expires_at = $5,
         aggregate_version = d.aggregate_version + 1, updated_at = $2
        FROM due
       WHERE d.tenant_id = $1 AND d.dispatch_id = due.dispatch_id
       RETURNING d.tenant_id,
              d.dispatch_id,
              d.application_id,
              d.cell_id,
              d.template_ref,
              d.template_version,
              d.channel,
              d.locale,
              d.recipient_handle_class,
              d.recipient_handle_ref,
              d.template_params,
              d.connector_binding_id,
              d.connector_mode,
              d.connector_environment,
              d.connector_critical,
              d.simulation_marker,
              d.status,
              d.attempts,
              d.max_attempts,
              d.next_attempt_at,
              d.lease_owner,
              d.lease_expires_at,
              d.provider_message_ref,
              d.last_error_code,
              d.idempotency_key,
              d.requested_by,
              d.requested_at,
              d.sent_at,
              d.delivered_at,
              d.correlation_id,
              d.aggregate_version,
              d.created_at,
              d.updated_at`,
      [this.tenantId, p.now.toISOString(), p.limit, p.leaseOwner, leaseUntil.toISOString()],
    );
    return r.rows.map(toDispatch);
  }

  async insertAttempt(row: AttemptRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_notification.dispatch_attempt (
         tenant_id, dispatch_id, attempt_no, outcome, error_code, provider_message_ref, connector_mode,
         simulation_marker, occurred_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        this.tenantId,
        row.dispatch_id,
        row.attempt_no,
        row.outcome,
        row.error_code,
        row.provider_message_ref,
        row.connector_mode,
        json(row.simulation_marker),
        row.occurred_at,
        row.correlation_id,
      ],
    );
  }

  async listAttempts(dispatchId: string): Promise<AttemptRow[]> {
    const r = await this.c.query(
      `SELECT dispatch_id, attempt_no, outcome, error_code, provider_message_ref, connector_mode,
              simulation_marker, occurred_at, correlation_id
         FROM sf_notification.dispatch_attempt
        WHERE tenant_id = $1 AND dispatch_id = $2 ORDER BY attempt_no`,
      [this.tenantId, dispatchId],
    );
    return r.rows.map(toAttempt);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_notification.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        this.tenantId,
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

export class PgNotificationRepository implements NotificationRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: NotificationTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp025Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp025Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
