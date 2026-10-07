import type { ActorType, EventEnvelope } from '../domain/validate.js';
import type { Assignment, GrievanceKind, GrievanceStatus } from '../domain/model.js';
import { Cmp027Error, mapPgError } from '../errors.js';
import type {
  AiAssistRow,
  AssignmentRequestRow,
  DbSession,
  GrievanceRow,
  GrievanceStore,
  GrievanceTx,
  IdempotencyKeyRef,
  IdempotencyLookup,
  ResponseRow,
  StoredResponse,
  TransitionRow,
} from './types.js';

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlQueryResult>;
  release(err?: Error | boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export const SCHEMA = 'sf_grievance';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const G_COLS = [
  'grievance_id',
  'tenant_id',
  'cell_id',
  'kind',
  'status',
  'aggregate_version',
  'reference_code',
  'category_code',
  'filer_id',
  'organisation_id',
  'jurisdiction_id',
  'office_id',
  'service_id',
  'application_id',
  'workflow_version_id',
  'created_by',
  'created_at',
  'updated_at',
  'last_correlation_id',
] as const;

const T_COLS = [
  'transition_id',
  'tenant_id',
  'grievance_id',
  'command',
  'from_status',
  'to_status',
  'aggregate_version',
  'idempotency_key',
  'authz_decision_id',
  'authz_policy_revision',
  'correlation_id',
  'actor_type',
  'actor_id',
  'reason_code',
  'policy_ref',
  'occurred_at',
] as const;

function placeholders(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');
}

const SQL = {
  insertG: `INSERT INTO sf_grievance.grievance (${G_COLS.join(',')}) VALUES (${placeholders(G_COLS.length)})`,
  selectG: `SELECT ${G_COLS.join(',')} FROM sf_grievance.grievance WHERE grievance_id = $1`,
  insertT: `INSERT INTO sf_grievance.grievance_transition (${T_COLS.join(',')}) VALUES (${placeholders(T_COLS.length)})`,
  listT: `SELECT ${T_COLS.join(',')} FROM sf_grievance.grievance_transition WHERE grievance_id = $1 ORDER BY aggregate_version`,
} as const;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function str(value: unknown): string {
  return String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function grievanceFromRow(r: Record<string, unknown>): GrievanceRow {
  return {
    grievance_id: str(r['grievance_id']),
    tenant_id: str(r['tenant_id']),
    cell_id: str(r['cell_id']),
    kind: str(r['kind']) as GrievanceKind,
    status: str(r['status']) as GrievanceStatus,
    aggregate_version: Number(r['aggregate_version']),
    reference_code: str(r['reference_code']),
    category_code: strOrNull(r['category_code']),
    filer_id: str(r['filer_id']),
    organisation_id: strOrNull(r['organisation_id']),
    jurisdiction_id: strOrNull(r['jurisdiction_id']),
    office_id: strOrNull(r['office_id']),
    service_id: strOrNull(r['service_id']),
    application_id: strOrNull(r['application_id']),
    workflow_version_id: strOrNull(r['workflow_version_id']),
    created_by: str(r['created_by']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: str(r['last_correlation_id']),
  };
}

function transitionFromRow(r: Record<string, unknown>): TransitionRow {
  return {
    transition_id: str(r['transition_id']),
    tenant_id: str(r['tenant_id']),
    grievance_id: str(r['grievance_id']),
    command: str(r['command']),
    from_status: strOrNull(r['from_status']) as GrievanceStatus | null,
    to_status: str(r['to_status']) as GrievanceStatus,
    aggregate_version: Number(r['aggregate_version']),
    idempotency_key: str(r['idempotency_key']),
    authz_decision_id: str(r['authz_decision_id']),
    authz_policy_revision: str(r['authz_policy_revision']),
    correlation_id: str(r['correlation_id']),
    actor_type: str(r['actor_type']) as ActorType,
    actor_id: str(r['actor_id']),
    reason_code: strOrNull(r['reason_code']),
    policy_ref: strOrNull(r['policy_ref']),
    occurred_at: iso(r['occurred_at']),
  };
}

function assignmentFrom(r: Record<string, unknown>): Assignment {
  return {
    role_code: str(r['role_code']),
    organisation_id: str(r['organisation_id']),
    office_id: strOrNull(r['office_id']),
    jurisdiction_id: str(r['jurisdiction_id']),
    service_scope_id: strOrNull(r['service_scope_id']),
  };
}

class PgTx implements GrievanceTx {
  constructor(
    private readonly client: SqlClient,
    private readonly tenantId: string,
  ) {}

  async lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup> {
    const { rows } = await this.client.query(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_grievance.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, ref.principalId, ref.endpoint, ref.key],
    );
    const row = rows[0];
    if (!row) return { state: 'absent' };
    const fingerprint = str(row['request_fingerprint']);
    if (row['status'] === 'COMPLETED' && row['response_status'] !== null) {
      return {
        state: 'completed',
        fingerprint,
        response: { status: Number(row['response_status']), body: row['response_body'] },
      };
    }
    return { state: 'pending', fingerprint };
  }

  async claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse> {
    const expires = new Date(ref.now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.client.query(
      `INSERT INTO sf_grievance.idempotency_record (
         tenant_id, principal_id, endpoint, idempotency_key, request_fingerprint, status, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (tenant_id, principal_id, endpoint, idempotency_key) DO NOTHING`,
      [
        this.tenantId,
        ref.principalId,
        ref.endpoint,
        ref.key,
        ref.fingerprint,
        ref.now.toISOString(),
        expires.toISOString(),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return 'claimed';
    const existing = await this.lookupIdempotency(ref);
    if (existing.state === 'absent') throw new Cmp027Error('SF-SYS-001');
    if (existing.fingerprint !== ref.fingerprint) throw new Cmp027Error('SF-APP-002');
    if (existing.state === 'completed') return existing.response;
    throw new Cmp027Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    await this.client.query(
      `UPDATE sf_grievance.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [
        `sf_grievance.idempotency_record:${ref.key}`,
        ref.response.status,
        JSON.stringify(ref.response.body),
        this.tenantId,
        ref.principalId,
        ref.endpoint,
        ref.key,
      ],
    );
  }

  async insertGrievance(row: GrievanceRow): Promise<void> {
    await this.client.query(
      SQL.insertG,
      G_COLS.map((c) => row[c]),
    );
  }

  async getGrievance(id: string, opts: { forUpdate?: boolean } = {}): Promise<GrievanceRow | null> {
    const sql = opts.forUpdate ? `${SQL.selectG} FOR UPDATE` : SQL.selectG;
    const { rows } = await this.client.query(sql, [id]);
    return rows[0] ? grievanceFromRow(rows[0]) : null;
  }

  async updateGrievance(params: {
    grievanceId: string;
    fromStatus: GrievanceStatus;
    toStatus: GrievanceStatus;
    fromVersion: number;
    categoryCode: string | null;
    organisationId: string | null;
    jurisdictionId: string | null;
    officeId: string | null;
    workflowVersionId: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_grievance.grievance
          SET status = $1, aggregate_version = aggregate_version + 1, updated_at = $2,
              last_correlation_id = $3, category_code = COALESCE($4, category_code),
              organisation_id = COALESCE($5, organisation_id),
              jurisdiction_id = COALESCE($6, jurisdiction_id),
              office_id = COALESCE($7, office_id),
              workflow_version_id = COALESCE($8, workflow_version_id)
        WHERE grievance_id = $9 AND status = $10 AND aggregate_version = $11`,
      [
        params.toStatus,
        params.updatedAt,
        params.correlationId,
        params.categoryCode,
        params.organisationId,
        params.jurisdictionId,
        params.officeId,
        params.workflowVersionId,
        params.grievanceId,
        params.fromStatus,
        params.fromVersion,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async insertTransition(row: TransitionRow): Promise<void> {
    await this.client.query(
      SQL.insertT,
      T_COLS.map((c) => row[c]),
    );
  }

  async listTransitions(grievanceId: string): Promise<TransitionRow[]> {
    const { rows } = await this.client.query(SQL.listT, [grievanceId]);
    return rows.map(transitionFromRow);
  }

  async insertResponse(row: ResponseRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_grievance.grievance_response (
         response_id, tenant_id, grievance_id, author_actor_type, author_id, body_ref, created_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.response_id,
        row.tenant_id,
        row.grievance_id,
        row.author_actor_type,
        row.author_id,
        row.body_ref,
        row.created_at,
        row.correlation_id,
      ],
    );
  }

  async listResponses(grievanceId: string): Promise<ResponseRow[]> {
    const { rows } = await this.client.query(
      `SELECT response_id, tenant_id, grievance_id, author_actor_type, author_id, body_ref, created_at, correlation_id
         FROM sf_grievance.grievance_response WHERE grievance_id = $1 ORDER BY created_at`,
      [grievanceId],
    );
    return rows.map((r) => ({
      response_id: str(r['response_id']),
      tenant_id: str(r['tenant_id']),
      grievance_id: str(r['grievance_id']),
      author_actor_type: str(r['author_actor_type']) as ActorType,
      author_id: str(r['author_id']),
      body_ref: str(r['body_ref']),
      created_at: iso(r['created_at']),
      correlation_id: str(r['correlation_id']),
    }));
  }

  async insertAssignmentRequest(row: AssignmentRequestRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_grievance.assignment_request (
         request_id, tenant_id, grievance_id, role_code, organisation_id, office_id,
         jurisdiction_id, service_scope_id, status, created_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.request_id,
        row.tenant_id,
        row.grievance_id,
        row.assignment.role_code,
        row.assignment.organisation_id,
        row.assignment.office_id,
        row.assignment.jurisdiction_id,
        row.assignment.service_scope_id,
        row.status,
        row.created_at,
        row.correlation_id,
      ],
    );
  }

  async getAssignmentRequest(grievanceId: string): Promise<AssignmentRequestRow | null> {
    const { rows } = await this.client.query(
      `SELECT request_id, tenant_id, grievance_id, role_code, organisation_id, office_id,
              jurisdiction_id, service_scope_id, status, created_at, correlation_id
         FROM sf_grievance.assignment_request WHERE grievance_id = $1`,
      [grievanceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      request_id: str(r['request_id']),
      tenant_id: str(r['tenant_id']),
      grievance_id: str(r['grievance_id']),
      assignment: assignmentFrom(r),
      status: 'REQUESTED',
      created_at: iso(r['created_at']),
      correlation_id: str(r['correlation_id']),
    };
  }

  async insertAiAssist(row: AiAssistRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sf_grievance.ai_assist_record (
         assist_id, tenant_id, grievance_id, kind, suggestion_code, duplicate_of_id, created_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.assist_id,
        row.tenant_id,
        row.grievance_id,
        row.kind,
        row.suggestion_code,
        row.duplicate_of_id,
        row.created_at,
        row.correlation_id,
      ],
    );
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    const partitionKey =
      topic === 'sf.audit.ingest.v1'
        ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
        : envelope.aggregate_id;
    await this.client.query(
      `INSERT INTO sf_grievance.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version,
         aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        topic,
        partitionKey,
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

export class PgGrievanceStore implements GrievanceStore {
  constructor(private readonly pool: SqlPool) {}

  async withTx<T>(session: DbSession, fn: (tx: GrievanceTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const settings: [string, string][] = [
        ['app.tenant_id', session.tenantId],
        ['app.cell_id', session.cellId],
        ['app.actor_type', session.actorType],
        ['app.actor_id', session.actorId],
        ['app.correlation_id', session.correlationId],
      ];
      for (const [key, value] of settings) {
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }
      const result = await fn(new PgTx(client, session.tenantId));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}
