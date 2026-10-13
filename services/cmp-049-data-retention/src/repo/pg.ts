import { AsyncLocalStorage } from 'node:async_hooks';
import type { Eligibility, EligibilityTransition } from '../domain/eligibility.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { PolicyScope, RetentionPolicyRecord } from '../domain/policy.js';
import { Cmp049Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  RetentionRepository,
  RetentionSubjectRecord,
  RetentionTx,
  StoredIdempotent,
  TransitionLogRow,
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
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function toPolicy(r: Record<string, unknown>): RetentionPolicyRecord {
  const scope: PolicyScope = { resource_type: String(r['resource_type']) };
  if (r['service_code'] !== null && r['service_code'] !== undefined) {
    scope.service_code = String(r['service_code']);
  }
  if (r['jurisdiction_code'] !== null && r['jurisdiction_code'] !== undefined) {
    scope.jurisdiction_code = String(r['jurisdiction_code']);
  }
  return {
    tenant_id: String(r['tenant_id']),
    policy_id: String(r['policy_id']),
    policy_version: Number(r['policy_version']),
    scope,
    owner_supplied_period_ref: strOrNull(r['owner_supplied_period_ref']),
    eligibility_transitions: json<EligibilityTransition[]>(r['eligibility_transitions']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    created_by: String(r['created_by']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toSubject(r: Record<string, unknown>): RetentionSubjectRecord {
  return {
    tenant_id: String(r['tenant_id']),
    subject_id: String(r['subject_id']),
    policy_id: String(r['policy_id']),
    resource_type: String(r['resource_type']),
    resource_id: String(r['resource_id']),
    eligibility: r['eligibility'] as Eligibility,
    subject_version: Number(r['subject_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

const SELECT_POLICY = `SELECT tenant_id, policy_id, policy_version, resource_type, service_code,
         jurisdiction_code, owner_supplied_period_ref, eligibility_transitions, created_at,
         updated_at, created_by, last_correlation_id
    FROM sf_retention.retention_policy WHERE tenant_id = $1 AND policy_id = $2`;
const SELECT_POLICY_FOR_UPDATE = `SELECT tenant_id, policy_id, policy_version, resource_type, service_code,
         jurisdiction_code, owner_supplied_period_ref, eligibility_transitions, created_at,
         updated_at, created_by, last_correlation_id
    FROM sf_retention.retention_policy WHERE tenant_id = $1 AND policy_id = $2 FOR UPDATE`;
const SELECT_SUBJECT = `SELECT tenant_id, subject_id, policy_id, resource_type, resource_id, eligibility,
         subject_version, created_at, updated_at, last_correlation_id
    FROM sf_retention.retention_subject WHERE tenant_id = $1 AND subject_id = $2`;
const SELECT_SUBJECT_FOR_UPDATE = `SELECT tenant_id, subject_id, policy_id, resource_type, resource_id, eligibility,
         subject_version, created_at, updated_at, last_correlation_id
    FROM sf_retention.retention_subject WHERE tenant_id = $1 AND subject_id = $2 FOR UPDATE`;

class PgTx implements RetentionTx {
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
      `INSERT INTO sf_retention.idempotency_record (
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
         FROM sf_retention.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp049Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp049Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp049Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_retention.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertPolicy(row: RetentionPolicyRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_retention.retention_policy (
         tenant_id, policy_id, policy_version, resource_type, service_code,
         jurisdiction_code, owner_supplied_period_ref, eligibility_transitions, created_at,
         updated_at, created_by, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
      [
        row.tenant_id,
        row.policy_id,
        row.policy_version,
        row.scope.resource_type,
        row.scope.service_code ?? null,
        row.scope.jurisdiction_code ?? null,
        row.owner_supplied_period_ref,
        JSON.stringify(row.eligibility_transitions),
        row.created_at,
        row.updated_at,
        row.created_by,
        row.last_correlation_id,
      ],
    );
  }

  async getPolicy(policyId: string, forUpdate = false): Promise<RetentionPolicyRecord | undefined> {
    const res = await this.c.query(forUpdate ? SELECT_POLICY_FOR_UPDATE : SELECT_POLICY, [
      this.tenantId,
      policyId,
    ]);
    const r = res.rows[0];
    return r ? toPolicy(r) : undefined;
  }

  async bindPolicyPeriodRef(row: RetentionPolicyRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_retention.retention_policy
          SET owner_supplied_period_ref = $3, policy_version = $4, updated_at = $5,
              last_correlation_id = $6
        WHERE tenant_id = $1 AND policy_id = $2 AND owner_supplied_period_ref IS NULL`,
      [
        this.tenantId,
        row.policy_id,
        row.owner_supplied_period_ref,
        row.policy_version,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp049Error('SF-APP-001');
  }

  async insertSubject(row: RetentionSubjectRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_retention.retention_subject (
         tenant_id, subject_id, policy_id, resource_type, resource_id, eligibility,
         subject_version, created_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.tenant_id,
        row.subject_id,
        row.policy_id,
        row.resource_type,
        row.resource_id,
        row.eligibility,
        row.subject_version,
        row.created_at,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
  }

  async getSubject(
    subjectId: string,
    forUpdate = false,
  ): Promise<RetentionSubjectRecord | undefined> {
    const res = await this.c.query(forUpdate ? SELECT_SUBJECT_FOR_UPDATE : SELECT_SUBJECT, [
      this.tenantId,
      subjectId,
    ]);
    const r = res.rows[0];
    return r ? toSubject(r) : undefined;
  }

  async findSubjectByResource(
    resourceType: string,
    resourceId: string,
  ): Promise<RetentionSubjectRecord | undefined> {
    const res = await this.c.query(
      `SELECT tenant_id, subject_id, policy_id, resource_type, resource_id, eligibility,
         subject_version, created_at, updated_at, last_correlation_id
         FROM sf_retention.retention_subject
        WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3`,
      [this.tenantId, resourceType, resourceId],
    );
    const r = res.rows[0];
    return r ? toSubject(r) : undefined;
  }

  async updateSubjectEligibility(row: RetentionSubjectRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_retention.retention_subject
          SET eligibility = $3, subject_version = $4, updated_at = $5, last_correlation_id = $6
        WHERE tenant_id = $1 AND subject_id = $2 AND subject_version = $4 - 1`,
      [
        this.tenantId,
        row.subject_id,
        row.eligibility,
        row.subject_version,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp049Error('SF-APP-001');
  }

  async insertTransition(row: TransitionLogRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_retention.retention_transition_log (
         tenant_id, transition_id, subject_id, policy_id, policy_version, from_eligibility,
         to_eligibility, owner_supplied_period_ref, reason_code, subject_version, actor_id,
         correlation_id, transitioned_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.tenant_id,
        row.transition_id,
        row.subject_id,
        row.policy_id,
        row.policy_version,
        row.from_eligibility,
        row.to_eligibility,
        row.owner_supplied_period_ref,
        row.reason_code,
        row.subject_version,
        row.actor_id,
        row.correlation_id,
        row.transitioned_at,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_retention.outbox_event (
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

export class PgRetentionRepository implements RetentionRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: RetentionTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp049Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp049Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
