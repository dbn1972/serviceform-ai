import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type {
  Channel,
  ClosureReason,
  ConsentRecord,
  LifecycleStatus,
  OperatorActionRecord,
  RepresentationRecord,
  SessionAggregate,
  SessionRecord,
} from '../domain/session.js';
import { Cmp057Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { ActorType, EventEnvelope, RequestContext } from '../types.js';
import type { AssistedReadTx, AssistedRepository, AssistedTx, StoredIdempotent } from './types.js';

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

function toSession(r: Record<string, unknown>): SessionRecord {
  return {
    tenant_id: String(r['tenant_id']),
    session_id: String(r['session_id']),
    channel: r['channel'] as Channel,
    applied_by_actor_id: String(r['applied_by_actor_id']),
    applied_by_actor_type: r['applied_by_actor_type'] as ActorType,
    applied_for_citizen_id: String(r['applied_for_citizen_id']),
    organisation_id: strOrNull(r['organisation_id']),
    office_id: strOrNull(r['office_id']),
    lifecycle_status: r['lifecycle_status'] as LifecycleStatus,
    session_version: Number(r['session_version']),
    idempotency_key: String(r['idempotency_key']),
    applicant_assurance_ref: strOrNull(r['applicant_assurance_ref']),
    application_id: strOrNull(r['application_id']),
    handoff_token_hash: strOrNull(r['handoff_token_hash']),
    handoff_expires_at: r['handoff_expires_at'] ? iso(r['handoff_expires_at']) : null,
    closure_reason: (strOrNull(r['closure_reason']) as ClosureReason | null) ?? null,
    started_at: iso(r['started_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toRepresentation(r: Record<string, unknown>): RepresentationRecord {
  return {
    tenant_id: String(r['tenant_id']),
    representation_id: String(r['representation_id']),
    session_id: String(r['session_id']),
    representation_authority_ref: strOrNull(r['representation_authority_ref']),
    valid_until: r['valid_until'] ? iso(r['valid_until']) : null,
    verified_by_actor_id: String(r['verified_by_actor_id']),
    verified_by_actor_type: r['verified_by_actor_type'] as ActorType,
    verified_at: iso(r['verified_at']),
  };
}

function toConsent(r: Record<string, unknown>): ConsentRecord {
  return {
    tenant_id: String(r['tenant_id']),
    consent_record_id: String(r['consent_record_id']),
    session_id: String(r['session_id']),
    consent_ref: String(r['consent_ref']),
    read_back_acknowledged: true,
    captured_by_actor_id: String(r['captured_by_actor_id']),
    captured_at: iso(r['captured_at']),
  };
}

function toAction(r: Record<string, unknown>): OperatorActionRecord {
  return {
    tenant_id: String(r['tenant_id']),
    action_id: String(r['action_id']),
    session_id: String(r['session_id']),
    sequence: Number(r['sequence']),
    command: r['command'] as OperatorActionRecord['command'],
    from_status: (strOrNull(r['from_status']) as LifecycleStatus | null) ?? null,
    to_status: r['to_status'] as LifecycleStatus,
    actor_type: r['actor_type'] as ActorType,
    actor_id: String(r['actor_id']),
    correlation_id: String(r['correlation_id']),
    acted_at: iso(r['acted_at']),
  };
}

const SELECT_SESSION = `SELECT tenant_id, session_id, channel, applied_by_actor_id,
  applied_by_actor_type, applied_for_citizen_id, organisation_id, office_id, lifecycle_status,
  session_version, idempotency_key, applicant_assurance_ref, application_id, handoff_token_hash,
  handoff_expires_at, closure_reason, started_at, updated_at, last_correlation_id
  FROM sf_assisted.assisted_session WHERE tenant_id = $1 AND session_id = $2`;

const SELECT_REP = `SELECT tenant_id, representation_id, session_id, representation_authority_ref,
  valid_until, verified_by_actor_id, verified_by_actor_type, verified_at
  FROM sf_assisted.representation_authority WHERE tenant_id = $1 AND session_id = $2`;

const SELECT_CONSENT = `SELECT tenant_id, consent_record_id, session_id, consent_ref,
  read_back_acknowledged, captured_by_actor_id, captured_at
  FROM sf_assisted.assisted_consent WHERE tenant_id = $1 AND session_id = $2`;

class PgReadTx implements AssistedReadTx {
  constructor(
    protected readonly c: SqlClient,
    protected readonly tenantId: string,
  ) {}

  protected async loadAggregate(
    sessionId: string,
    forUpdate: boolean,
  ): Promise<SessionAggregate | undefined> {
    const sql = forUpdate ? `${SELECT_SESSION} FOR UPDATE` : SELECT_SESSION;
    const res = await this.c.query(sql, [this.tenantId, sessionId]);
    const row = res.rows[0];
    if (!row) return undefined;
    const session = toSession(row);
    const [rep, consent] = await Promise.all([
      this.c.query(SELECT_REP, [this.tenantId, sessionId]),
      this.c.query(SELECT_CONSENT, [this.tenantId, sessionId]),
    ]);
    const agg: SessionAggregate = { session };
    if (rep.rows[0]) agg.representation = toRepresentation(rep.rows[0]);
    if (consent.rows[0]) agg.consent = toConsent(consent.rows[0]);
    return agg;
  }

  getSession(sessionId: string): Promise<SessionAggregate | undefined> {
    return this.loadAggregate(sessionId, false);
  }

  async listActions(sessionId: string): Promise<OperatorActionRecord[]> {
    const res = await this.c.query(
      `SELECT tenant_id, action_id, session_id, sequence, command, from_status, to_status,
              actor_type, actor_id, correlation_id, acted_at
         FROM sf_assisted.operator_action_audit
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY sequence ASC`,
      [this.tenantId, sessionId],
    );
    return res.rows.map(toAction);
  }
}

class PgTx extends PgReadTx implements AssistedTx {
  getSessionForUpdate(sessionId: string): Promise<SessionAggregate | undefined> {
    return this.loadAggregate(sessionId, true);
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
      `INSERT INTO sf_assisted.idempotency_record (
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
         FROM sf_assisted.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp057Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp057Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp057Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_assisted.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertSession(row: SessionRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_assisted.assisted_session (
         tenant_id, session_id, channel, applied_by_actor_id, applied_by_actor_type,
         applied_for_citizen_id, organisation_id, office_id, lifecycle_status, session_version,
         idempotency_key, applicant_assurance_ref, application_id, handoff_token_hash,
         handoff_expires_at, closure_reason, started_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        row.tenant_id,
        row.session_id,
        row.channel,
        row.applied_by_actor_id,
        row.applied_by_actor_type,
        row.applied_for_citizen_id,
        row.organisation_id,
        row.office_id,
        row.lifecycle_status,
        row.session_version,
        row.idempotency_key,
        row.applicant_assurance_ref,
        row.application_id,
        row.handoff_token_hash,
        row.handoff_expires_at,
        row.closure_reason,
        row.started_at,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
  }

  async updateSession(row: SessionRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_assisted.assisted_session
          SET lifecycle_status = $3, session_version = $4, applicant_assurance_ref = $5,
              application_id = $6, handoff_token_hash = $7, handoff_expires_at = $8,
              closure_reason = $9, updated_at = $10, last_correlation_id = $11
        WHERE tenant_id = $1 AND session_id = $2 AND session_version = $4 - 1`,
      [
        this.tenantId,
        row.session_id,
        row.lifecycle_status,
        row.session_version,
        row.applicant_assurance_ref,
        row.application_id,
        row.handoff_token_hash,
        row.handoff_expires_at,
        row.closure_reason,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp057Error('SF-APP-001');
  }

  async insertRepresentation(row: RepresentationRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_assisted.representation_authority (
         tenant_id, representation_id, session_id, representation_authority_ref, valid_until,
         verified_by_actor_id, verified_by_actor_type, verified_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.tenant_id,
        row.representation_id,
        row.session_id,
        row.representation_authority_ref,
        row.valid_until,
        row.verified_by_actor_id,
        row.verified_by_actor_type,
        row.verified_at,
      ],
    );
  }

  async insertConsent(row: ConsentRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_assisted.assisted_consent (
         tenant_id, consent_record_id, session_id, consent_ref, read_back_acknowledged,
         captured_by_actor_id, captured_at
       ) VALUES ($1,$2,$3,$4,true,$5,$6)`,
      [
        row.tenant_id,
        row.consent_record_id,
        row.session_id,
        row.consent_ref,
        row.captured_by_actor_id,
        row.captured_at,
      ],
    );
  }

  async insertAction(row: OperatorActionRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_assisted.operator_action_audit (
         tenant_id, action_id, session_id, sequence, command, from_status, to_status,
         actor_type, actor_id, correlation_id, acted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.tenant_id,
        row.action_id,
        row.session_id,
        row.sequence,
        row.command,
        row.from_status,
        row.to_status,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
        row.acted_at,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_assisted.outbox_event (
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

export class PgAssistedRepository implements AssistedRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  withTx<T>(ctx: RequestContext, fn: (tx: AssistedTx) => Promise<T>): Promise<T> {
    return this.run(ctx, 'BEGIN', (c, tenantId) => fn(new PgTx(c, tenantId)));
  }

  /** READ ONLY at the database: any write attempted by a read port fails with 25006. */
  withReadTx<T>(ctx: RequestContext, fn: (tx: AssistedReadTx) => Promise<T>): Promise<T> {
    return this.run(ctx, 'BEGIN READ ONLY', (c, tenantId) => fn(new PgReadTx(c, tenantId)));
  }

  private async run<T>(
    ctx: RequestContext,
    begin: 'BEGIN' | 'BEGIN READ ONLY',
    fn: (c: SqlClient, tenantId: string) => Promise<T>,
  ): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp057Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp057Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
