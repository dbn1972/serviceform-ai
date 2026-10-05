import type { CaseState, RequestKind, RequestStatus, TransitionClass } from '../domain/model.js';
import type { PinGraph } from '../domain/pins.js';
import { OPTIONAL_PINS, REQUIRED_PINS } from '../domain/pins.js';
import type { ActorType, EventEnvelope } from '../domain/validate.js';
import { Cmp015Error, mapPgError } from '../errors.js';
import type {
  CaseRow,
  CaseStore,
  CaseTx,
  DbSession,
  IdempotencyKeyRef,
  IdempotencyLookup,
  RequestRow,
  StoredResponse,
  TransitionRow,
} from './types.js';

/** Structural subset of node-postgres (pg.Pool / pg.PoolClient); the host injects the real pool. */
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

export const SCHEMA = 'sf_application_case';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const PIN_COLUMNS = [...REQUIRED_PINS, ...OPTIONAL_PINS] as const;

const CASE_COLUMNS = [
  'application_id',
  'tenant_id',
  'cell_id',
  'service_id',
  'applicant_id',
  'organisation_id',
  'jurisdiction_id',
  'state',
  'aggregate_version',
  ...PIN_COLUMNS,
  'pin_graph_hash',
  'created_by',
  'created_at',
  'updated_at',
  'submitted_at',
  'last_correlation_id',
] as const;

const TRANSITION_COLUMNS = [
  'transition_id',
  'tenant_id',
  'application_id',
  'command',
  'from_state',
  'to_state',
  'transition_key',
  'transition_class',
  'aggregate_version',
  'idempotency_key',
  'authz_decision_id',
  'authz_policy_revision',
  'correlation_id',
  'actor_type',
  'actor_id',
  'reason_code',
  'request_id',
  'policy_ref',
  'occurred_at',
] as const;

const REQUEST_COLUMNS = [
  'request_id',
  'tenant_id',
  'application_id',
  'kind',
  'status',
  'workflow_ref',
  'status_reason_code',
  'case_state_at_request',
  'consumed_at_version',
  'created_by',
  'created_at',
  'updated_at',
  'last_correlation_id',
] as const;

function placeholders(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',');
}

/** Static SQL built once from the fixed column lists above (no runtime input is interpolated). */
const SQL = {
  insertCase: `INSERT INTO sf_application_case.application_case (${CASE_COLUMNS.join(',')}) VALUES (${placeholders(CASE_COLUMNS.length)})`,
  selectCase: `SELECT ${CASE_COLUMNS.join(',')} FROM sf_application_case.application_case WHERE application_id = $1`,
  insertTransition: `INSERT INTO sf_application_case.case_transition (${TRANSITION_COLUMNS.join(',')}) VALUES (${placeholders(TRANSITION_COLUMNS.length)})`,
  listTransitions: `SELECT ${TRANSITION_COLUMNS.join(',')} FROM sf_application_case.case_transition WHERE application_id = $1 ORDER BY aggregate_version`,
  insertRequest: `INSERT INTO sf_application_case.case_request_reference (${REQUEST_COLUMNS.join(',')}) VALUES (${placeholders(REQUEST_COLUMNS.length)})`,
  selectRequest: `SELECT ${REQUEST_COLUMNS.join(',')} FROM sf_application_case.case_request_reference WHERE request_id = $1`,
} as const;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function str(value: unknown): string {
  return String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function caseFromRow(r: Record<string, unknown>): CaseRow {
  const pins: Record<string, string> = {};
  for (const col of PIN_COLUMNS) {
    const v = r[col];
    if (v !== null && v !== undefined) pins[col] = String(v);
  }
  return {
    application_id: str(r['application_id']),
    tenant_id: str(r['tenant_id']),
    cell_id: str(r['cell_id']),
    service_id: str(r['service_id']),
    applicant_id: str(r['applicant_id']),
    organisation_id: strOrNull(r['organisation_id']),
    jurisdiction_id: strOrNull(r['jurisdiction_id']),
    state: str(r['state']) as CaseState,
    aggregate_version: Number(r['aggregate_version']),
    pins: pins as unknown as PinGraph,
    pin_graph_hash: str(r['pin_graph_hash']),
    created_by: str(r['created_by']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    submitted_at: isoOrNull(r['submitted_at']),
    last_correlation_id: str(r['last_correlation_id']),
  };
}

function transitionFromRow(r: Record<string, unknown>): TransitionRow {
  return {
    transition_id: str(r['transition_id']),
    tenant_id: str(r['tenant_id']),
    application_id: str(r['application_id']),
    command: str(r['command']),
    from_state: strOrNull(r['from_state']) as CaseState | null,
    to_state: str(r['to_state']) as CaseState,
    transition_key: strOrNull(r['transition_key']),
    transition_class: strOrNull(r['transition_class']) as TransitionClass | null,
    aggregate_version: Number(r['aggregate_version']),
    idempotency_key: str(r['idempotency_key']),
    authz_decision_id: str(r['authz_decision_id']),
    authz_policy_revision: str(r['authz_policy_revision']),
    correlation_id: str(r['correlation_id']),
    actor_type: str(r['actor_type']) as ActorType,
    actor_id: str(r['actor_id']),
    reason_code: strOrNull(r['reason_code']),
    request_id: strOrNull(r['request_id']),
    policy_ref: strOrNull(r['policy_ref']),
    occurred_at: iso(r['occurred_at']),
  };
}

function requestFromRow(r: Record<string, unknown>): RequestRow {
  return {
    request_id: str(r['request_id']),
    tenant_id: str(r['tenant_id']),
    application_id: str(r['application_id']),
    kind: str(r['kind']) as RequestKind,
    status: str(r['status']) as RequestStatus,
    workflow_ref: strOrNull(r['workflow_ref']),
    status_reason_code: strOrNull(r['status_reason_code']),
    case_state_at_request: str(r['case_state_at_request']) as CaseState,
    consumed_at_version:
      r['consumed_at_version'] === null || r['consumed_at_version'] === undefined
        ? null
        : Number(r['consumed_at_version']),
    created_by: str(r['created_by']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: str(r['last_correlation_id']),
  };
}

class PgCaseTx implements CaseTx {
  constructor(
    private readonly client: SqlClient,
    private readonly tenantId: string,
  ) {}

  async lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup> {
    const { rows } = await this.client.query(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_application_case.idempotency_record
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
      `INSERT INTO sf_application_case.idempotency_record (
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
    if (existing.state === 'absent') throw new Cmp015Error('SF-SYS-001');
    if (existing.fingerprint !== ref.fingerprint) throw new Cmp015Error('SF-APP-002');
    if (existing.state === 'completed') return existing.response;
    throw new Cmp015Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    await this.client.query(
      `UPDATE sf_application_case.idempotency_record
          SET status = 'COMPLETED', response_ref = $1, response_status = $2, response_body = $3::jsonb
        WHERE tenant_id = $4 AND principal_id = $5 AND endpoint = $6 AND idempotency_key = $7`,
      [
        `sf_application_case.idempotency_record:${ref.key}`,
        ref.response.status,
        JSON.stringify(ref.response.body),
        this.tenantId,
        ref.principalId,
        ref.endpoint,
        ref.key,
      ],
    );
  }

  async insertCase(row: CaseRow): Promise<void> {
    const pins = row.pins as unknown as Record<string, string | undefined>;
    const values: unknown[] = [
      row.application_id,
      row.tenant_id,
      row.cell_id,
      row.service_id,
      row.applicant_id,
      row.organisation_id,
      row.jurisdiction_id,
      row.state,
      row.aggregate_version,
      ...PIN_COLUMNS.map((c) => pins[c] ?? null),
      row.pin_graph_hash,
      row.created_by,
      row.created_at,
      row.updated_at,
      row.submitted_at,
      row.last_correlation_id,
    ];
    await this.client.query(SQL.insertCase, values);
  }

  async getCase(
    applicationId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<CaseRow | null> {
    const sql = opts.forUpdate ? `${SQL.selectCase} FOR UPDATE` : SQL.selectCase;
    const { rows } = await this.client.query(sql, [applicationId]);
    return rows[0] ? caseFromRow(rows[0]) : null;
  }

  async updateCaseState(params: {
    applicationId: string;
    fromState: CaseState;
    toState: CaseState;
    fromVersion: number;
    updatedAt: string;
    submittedAt: string | null;
    correlationId: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_application_case.application_case
          SET state = $1, aggregate_version = aggregate_version + 1, updated_at = $2,
              submitted_at = COALESCE($3, submitted_at), last_correlation_id = $4
        WHERE application_id = $5 AND state = $6 AND aggregate_version = $7`,
      [
        params.toState,
        params.updatedAt,
        params.submittedAt,
        params.correlationId,
        params.applicationId,
        params.fromState,
        params.fromVersion,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async insertTransition(row: TransitionRow): Promise<void> {
    await this.client.query(
      SQL.insertTransition,
      TRANSITION_COLUMNS.map((c) => row[c]),
    );
  }

  async listTransitions(applicationId: string): Promise<TransitionRow[]> {
    const { rows } = await this.client.query(SQL.listTransitions, [applicationId]);
    return rows.map(transitionFromRow);
  }

  async insertRequest(row: RequestRow): Promise<void> {
    await this.client.query(
      SQL.insertRequest,
      REQUEST_COLUMNS.map((c) => row[c]),
    );
  }

  async getRequest(
    requestId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<RequestRow | null> {
    const sql = opts.forUpdate ? `${SQL.selectRequest} FOR UPDATE` : SQL.selectRequest;
    const { rows } = await this.client.query(sql, [requestId]);
    return rows[0] ? requestFromRow(rows[0]) : null;
  }

  async updateRequestStatus(params: {
    requestId: string;
    fromStatus: RequestStatus;
    toStatus: RequestStatus;
    reasonCode: string | null;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_application_case.case_request_reference
          SET status = $1, status_reason_code = $2, updated_at = $3, last_correlation_id = $4
        WHERE request_id = $5 AND status = $6`,
      [
        params.toStatus,
        params.reasonCode,
        params.updatedAt,
        params.correlationId,
        params.requestId,
        params.fromStatus,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async consumeRequest(params: {
    requestId: string;
    atVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE sf_application_case.case_request_reference
          SET consumed_at_version = $1, updated_at = $2, last_correlation_id = $3
        WHERE request_id = $4 AND status = 'COMMITTED' AND consumed_at_version IS NULL`,
      [params.atVersion, params.updatedAt, params.correlationId, params.requestId],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    const partitionKey =
      topic === 'sf.audit.ingest.v1'
        ? `audit:${String((envelope.data as { audit_id?: string }).audit_id ?? envelope.aggregate_id)}`
        : envelope.aggregate_id;
    await this.client.query(
      `INSERT INTO sf_application_case.outbox_event (
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

export class PgCaseStore implements CaseStore {
  constructor(private readonly pool: SqlPool) {}

  async withTx<T>(session: DbSession, fn: (tx: CaseTx) => Promise<T>): Promise<T> {
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
      const result = await fn(new PgCaseTx(client, session.tenantId));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already failed; release below discards it */
      }
      throw mapPgError(err);
    } finally {
      client.release();
    }
  }
}
