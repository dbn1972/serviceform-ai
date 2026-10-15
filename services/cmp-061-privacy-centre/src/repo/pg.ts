import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type {
  FulfilmentTaskRecord,
  LifecycleStatus,
  PrivacyRequestRecord,
  RequestType,
  ScopeItem,
  TaskStatus,
} from '../domain/request.js';
import { Cmp061Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type { DecisionLogRow, PrivacyRepository, PrivacyTx, StoredIdempotent } from './types.js';

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

function toRequest(r: Record<string, unknown>): PrivacyRequestRecord {
  return {
    tenant_id: String(r['tenant_id']),
    request_id: String(r['request_id']),
    subject_actor_id: String(r['subject_actor_id']),
    request_type: r['request_type'] as RequestType,
    lifecycle_status: r['lifecycle_status'] as LifecycleStatus,
    legal_basis_or_exception_ref: strOrNull(r['legal_basis_or_exception_ref']),
    submit_assurance: r['submit_assurance'] as PrivacyRequestRecord['submit_assurance'],
    idempotency_key: String(r['idempotency_key']),
    request_version: Number(r['request_version']),
    scope_count: Number(r['scope_count']),
    correlation_id: String(r['correlation_id']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toTask(r: Record<string, unknown>): FulfilmentTaskRecord {
  return {
    tenant_id: String(r['tenant_id']),
    task_id: String(r['task_id']),
    request_id: String(r['request_id']),
    scope_seq: Number(r['scope_seq']),
    owner_component: String(r['owner_component']),
    task_status: r['task_status'] as TaskStatus,
    evidence_ref: strOrNull(r['evidence_ref']),
    legal_basis_or_exception_ref: strOrNull(r['legal_basis_or_exception_ref']),
    exception_authority_ref: strOrNull(r['exception_authority_ref']),
    task_version: Number(r['task_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

const SELECT_REQUEST = `SELECT tenant_id, request_id, subject_actor_id, request_type, lifecycle_status,
         legal_basis_or_exception_ref, submit_assurance, idempotency_key, request_version, scope_count,
         correlation_id, created_at, updated_at, last_correlation_id
    FROM sf_privacy.privacy_request WHERE tenant_id = $1 AND request_id = $2`;
const SELECT_REQUEST_FOR_UPDATE = `${SELECT_REQUEST} FOR UPDATE`;
const SELECT_TASK = `SELECT tenant_id, task_id, request_id, scope_seq, owner_component, task_status,
         evidence_ref, legal_basis_or_exception_ref, exception_authority_ref, task_version,
         created_at, updated_at, last_correlation_id
    FROM sf_privacy.privacy_fulfilment_task WHERE tenant_id = $1 AND task_id = $2`;
const SELECT_TASK_FOR_UPDATE = `${SELECT_TASK} FOR UPDATE`;

class PgTx implements PrivacyTx {
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
      `INSERT INTO sf_privacy.idempotency_record (
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
         FROM sf_privacy.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp061Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp061Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp061Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_privacy.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertRequest(row: PrivacyRequestRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_privacy.privacy_request (
         tenant_id, request_id, subject_actor_id, request_type, lifecycle_status,
         legal_basis_or_exception_ref, submit_assurance, idempotency_key, request_version, scope_count,
         invented_statutory_policy_forbidden, cross_component_direct_mutation_forbidden,
         owner_task_orchestration_only, correlation_id, created_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,true,$11,$12,$13,$14)`,
      [
        row.tenant_id,
        row.request_id,
        row.subject_actor_id,
        row.request_type,
        row.lifecycle_status,
        row.legal_basis_or_exception_ref,
        row.submit_assurance,
        row.idempotency_key,
        row.request_version,
        row.scope_count,
        row.correlation_id,
        row.created_at,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
  }

  async insertScope(
    tenantId: string,
    requestId: string,
    items: readonly ScopeItem[],
    createdAt: string,
  ): Promise<void> {
    for (const item of items) {
      await this.c.query(
        `INSERT INTO sf_privacy.privacy_request_scope (
           tenant_id, request_id, scope_seq, owner_component, scope_ref, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, requestId, item.scope_seq, item.owner_component, item.scope_ref, createdAt],
      );
    }
  }

  async getRequest(
    requestId: string,
    forUpdate = false,
  ): Promise<PrivacyRequestRecord | undefined> {
    const res = await this.c.query(forUpdate ? SELECT_REQUEST_FOR_UPDATE : SELECT_REQUEST, [
      this.tenantId,
      requestId,
    ]);
    const r = res.rows[0];
    return r ? toRequest(r) : undefined;
  }

  async listRequestsForSubject(subjectActorId: string): Promise<PrivacyRequestRecord[]> {
    const res = await this.c.query(
      `SELECT tenant_id, request_id, subject_actor_id, request_type, lifecycle_status,
              legal_basis_or_exception_ref, submit_assurance, idempotency_key, request_version, scope_count,
              correlation_id, created_at, updated_at, last_correlation_id
         FROM sf_privacy.privacy_request
        WHERE tenant_id = $1 AND subject_actor_id = $2
        ORDER BY created_at DESC`,
      [this.tenantId, subjectActorId],
    );
    return res.rows.map(toRequest);
  }

  async listScope(requestId: string): Promise<ScopeItem[]> {
    const res = await this.c.query(
      `SELECT scope_seq, owner_component, scope_ref
         FROM sf_privacy.privacy_request_scope
        WHERE tenant_id = $1 AND request_id = $2
        ORDER BY scope_seq`,
      [this.tenantId, requestId],
    );
    return res.rows.map((r) => ({
      scope_seq: Number(r['scope_seq']),
      owner_component: String(r['owner_component']),
      scope_ref: String(r['scope_ref']),
    }));
  }

  async updateRequest(row: PrivacyRequestRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_privacy.privacy_request
          SET lifecycle_status = $3, legal_basis_or_exception_ref = $4, request_version = $5,
              updated_at = $6, last_correlation_id = $7
        WHERE tenant_id = $1 AND request_id = $2 AND request_version = $5 - 1`,
      [
        this.tenantId,
        row.request_id,
        row.lifecycle_status,
        row.legal_basis_or_exception_ref,
        row.request_version,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp061Error('SF-APP-001');
  }

  async insertTask(row: FulfilmentTaskRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_privacy.privacy_fulfilment_task (
         tenant_id, task_id, request_id, scope_seq, owner_component, task_status,
         evidence_ref, legal_basis_or_exception_ref, exception_authority_ref, task_version,
         created_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.tenant_id,
        row.task_id,
        row.request_id,
        row.scope_seq,
        row.owner_component,
        row.task_status,
        row.evidence_ref,
        row.legal_basis_or_exception_ref,
        row.exception_authority_ref,
        row.task_version,
        row.created_at,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
  }

  async getTask(taskId: string, forUpdate = false): Promise<FulfilmentTaskRecord | undefined> {
    const res = await this.c.query(forUpdate ? SELECT_TASK_FOR_UPDATE : SELECT_TASK, [
      this.tenantId,
      taskId,
    ]);
    const r = res.rows[0];
    return r ? toTask(r) : undefined;
  }

  async listTasks(requestId: string): Promise<FulfilmentTaskRecord[]> {
    const res = await this.c.query(
      `SELECT tenant_id, task_id, request_id, scope_seq, owner_component, task_status,
              evidence_ref, legal_basis_or_exception_ref, exception_authority_ref, task_version,
              created_at, updated_at, last_correlation_id
         FROM sf_privacy.privacy_fulfilment_task
        WHERE tenant_id = $1 AND request_id = $2
        ORDER BY scope_seq`,
      [this.tenantId, requestId],
    );
    return res.rows.map(toTask);
  }

  async updateTask(row: FulfilmentTaskRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_privacy.privacy_fulfilment_task
          SET task_status = $3, evidence_ref = $4, legal_basis_or_exception_ref = $5,
              exception_authority_ref = $6, task_version = $7, updated_at = $8,
              last_correlation_id = $9
        WHERE tenant_id = $1 AND task_id = $2 AND task_version = $7 - 1`,
      [
        this.tenantId,
        row.task_id,
        row.task_status,
        row.evidence_ref,
        row.legal_basis_or_exception_ref,
        row.exception_authority_ref,
        row.task_version,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp061Error('SF-APP-001');
  }

  async insertDecision(row: DecisionLogRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_privacy.privacy_decision (
         tenant_id, decision_id, request_id, from_status, to_status, legal_basis_or_exception_ref,
         request_version, actor_type, actor_id, correlation_id, decided_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.tenant_id,
        row.decision_id,
        row.request_id,
        row.from_status,
        row.to_status,
        row.legal_basis_or_exception_ref,
        row.request_version,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
        row.decided_at,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_privacy.outbox_event (
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

export class PgPrivacyRepository implements PrivacyRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: PrivacyTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp061Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp061Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
