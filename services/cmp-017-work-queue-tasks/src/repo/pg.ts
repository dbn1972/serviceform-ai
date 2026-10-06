import { dbSessionSettings, type EventEnvelope } from '../contracts.js';
import type { Assignment } from '../domain/assignment.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { PrincipalScope } from '../domain/resolution.js';
import type { TaskState } from '../domain/states.js';
import { Cmp017Error, mapPgError } from '../errors.js';
import { guardClient, type SqlClient, type SqlPool, type SqlQueryable } from '../sql.js';
import type {
  HistoryRow,
  NewHistory,
  NewTask,
  RepoContext,
  StoredIdempotent,
  TaskPatch,
  TaskReadTx,
  TaskRepository,
  TaskRow,
  TaskWriteTx,
} from './types.js';

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toAssignment(row: Row): Assignment {
  return {
    role_code: String(row['role_code']),
    organisation_id: String(row['organisation_id']),
    office_id: strOrNull(row['office_id']),
    jurisdiction_id: String(row['jurisdiction_id']),
    service_scope_id: strOrNull(row['service_scope_id']),
  };
}

export function toTask(row: Row): TaskRow {
  return {
    tenant_id: String(row['tenant_id']),
    task_id: String(row['task_id']),
    application_id: String(row['application_id']),
    workflow_node_id: strOrNull(row['workflow_node_id']),
    cell_id: String(row['cell_id']),
    task_state: row['task_state'] as TaskState,
    assignment: toAssignment(row),
    claimed_principal_id: strOrNull(row['claimed_principal_id']),
    claimed_at: row['claimed_at'] ? iso(row['claimed_at']) : null,
    outcome: strOrNull(row['outcome']),
    created_by: String(row['created_by']),
    correlation_id: String(row['correlation_id']),
    aggregate_version: Number(row['aggregate_version']),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}

export function toHistory(row: Row): HistoryRow {
  return {
    history_id: String(row['history_id']),
    task_id: String(row['task_id']),
    seq: Number(row['seq']),
    operation: row['operation'] as HistoryRow['operation'],
    from_state: (row['from_state'] as TaskState | null) ?? null,
    to_state: row['to_state'] as TaskState,
    actor_type: String(row['actor_type']),
    actor_id: String(row['actor_id']),
    assignment: toAssignment(row),
    claimed_principal_id: strOrNull(row['claimed_principal_id']),
    outcome: strOrNull(row['outcome']),
    authz_decision_id: String(row['authz_decision_id']),
    policy_revision: String(row['policy_revision']),
    target_authz_decision_id: strOrNull(row['target_authz_decision_id']),
    idempotency_key: String(row['idempotency_key']),
    correlation_id: String(row['correlation_id']),
    occurred_at: iso(row['occurred_at']),
  };
}

class PgTx implements TaskWriteTx, TaskReadTx {
  constructor(
    private readonly c: SqlQueryable,
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
      `INSERT INTO sf_tasks.idempotency_record (
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
         FROM sf_tasks.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp017Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp017Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp017Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_tasks.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    const r = await this.c.query(
      `SELECT tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, claimed_at, outcome, created_by, correlation_id,
         aggregate_version, created_at, updated_at FROM sf_tasks.human_task WHERE tenant_id = $1 AND task_id = $2`,
      [this.tenantId, taskId],
    );
    return r.rows[0] ? toTask(r.rows[0]) : null;
  }

  async lockTask(taskId: string): Promise<TaskRow | null> {
    const r = await this.c.query(
      `SELECT tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, claimed_at, outcome, created_by, correlation_id,
         aggregate_version, created_at, updated_at FROM sf_tasks.human_task
        WHERE tenant_id = $1 AND task_id = $2 FOR UPDATE`,
      [this.tenantId, taskId],
    );
    return r.rows[0] ? toTask(r.rows[0]) : null;
  }

  async listAvailable(scope: PrincipalScope, limit: number): Promise<TaskRow[]> {
    const r = await this.c.query(
      `SELECT tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, claimed_at, outcome, created_by, correlation_id,
         aggregate_version, created_at, updated_at FROM sf_tasks.human_task
        WHERE tenant_id = $1 AND task_state = 'OPEN'
          AND role_code = ANY($2::text[])
          AND organisation_id = ANY($3::uuid[])
          AND (office_id IS NULL OR office_id = ANY($4::uuid[]))
          AND jurisdiction_id = ANY($5::uuid[])
          AND (service_scope_id IS NULL OR service_scope_id = ANY($6::uuid[]))
        ORDER BY created_at, task_id
        LIMIT $7`,
      [
        this.tenantId,
        scope.roles,
        scope.organisation_ids,
        scope.office_ids,
        scope.jurisdiction_ids,
        scope.service_scope_ids,
        limit,
      ],
    );
    return r.rows.map(toTask);
  }

  async listHistory(taskId: string): Promise<HistoryRow[]> {
    const r = await this.c.query(
      `SELECT history_id, task_id, seq, operation, from_state, to_state, actor_type,
         actor_id, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, outcome, authz_decision_id, policy_revision,
         target_authz_decision_id, idempotency_key, correlation_id, occurred_at FROM sf_tasks.task_history
        WHERE tenant_id = $1 AND task_id = $2 ORDER BY seq`,
      [this.tenantId, taskId],
    );
    return r.rows.map(toHistory);
  }

  async insertTask(t: NewTask): Promise<TaskRow> {
    const a = t.assignment;
    const r = await this.c.query(
      `INSERT INTO sf_tasks.human_task (
         tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         created_by, correlation_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, claimed_at, outcome, created_by, correlation_id,
         aggregate_version, created_at, updated_at`,
      [
        this.tenantId,
        t.task_id,
        t.application_id,
        t.workflow_node_id,
        t.cell_id,
        a.role_code,
        a.organisation_id,
        a.office_id,
        a.jurisdiction_id,
        a.service_scope_id,
        t.created_by,
        t.correlation_id,
        t.now.toISOString(),
      ],
    );
    return toTask(r.rows[0] as Row);
  }

  async updateTask(taskId: string, p: TaskPatch): Promise<TaskRow> {
    const a = p.assignment;
    const r = await this.c.query(
      `UPDATE sf_tasks.human_task
          SET task_state = $3, role_code = $4, organisation_id = $5, office_id = $6,
              jurisdiction_id = $7, service_scope_id = $8, claimed_principal_id = $9,
              claimed_at = $10, outcome = $11, aggregate_version = aggregate_version + 1,
              updated_at = $12
        WHERE tenant_id = $1 AND task_id = $2 AND aggregate_version = $13
        RETURNING tenant_id, task_id, application_id, workflow_node_id, cell_id, task_state,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, claimed_at, outcome, created_by, correlation_id,
         aggregate_version, created_at, updated_at`,
      [
        this.tenantId,
        taskId,
        p.task_state,
        a.role_code,
        a.organisation_id,
        a.office_id,
        a.jurisdiction_id,
        a.service_scope_id,
        p.claimed_principal_id,
        p.claimed_at ? p.claimed_at.toISOString() : null,
        p.outcome,
        p.now.toISOString(),
        p.expected_version,
      ],
    );
    if (!r.rows[0]) throw new Cmp017Error('SF-APP-001');
    return toTask(r.rows[0]);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const a = h.assignment;
    const r = await this.c.query(
      `INSERT INTO sf_tasks.task_history (
         tenant_id, history_id, task_id, seq, operation, from_state, to_state, actor_type, actor_id,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, outcome, authz_decision_id, policy_revision,
         target_authz_decision_id, idempotency_key, correlation_id, occurred_at
       ) VALUES (
         $1,$2,$3,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM sf_tasks.task_history WHERE tenant_id = $1 AND task_id = $3),
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
       ) RETURNING history_id, task_id, seq, operation, from_state, to_state, actor_type,
         actor_id, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, outcome, authz_decision_id, policy_revision,
         target_authz_decision_id, idempotency_key, correlation_id, occurred_at`,
      [
        this.tenantId,
        h.history_id,
        h.task_id,
        h.operation,
        h.from_state,
        h.to_state,
        h.actor_type,
        h.actor_id,
        a.role_code,
        a.organisation_id,
        a.office_id,
        a.jurisdiction_id,
        a.service_scope_id,
        h.claimed_principal_id,
        h.outcome,
        h.authz_decision_id,
        h.policy_revision,
        h.target_authz_decision_id,
        h.idempotency_key,
        h.correlation_id,
        h.now.toISOString(),
      ],
    );
    return toHistory(r.rows[0] as Row);
  }

  async insertOutbox(env: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_tasks.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version,
         aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        env.event_id,
        this.tenantId,
        topic,
        env.aggregate_id,
        env.event_type,
        env.schema_version,
        env.aggregate_type,
        env.aggregate_id,
        env.aggregate_version,
        JSON.stringify(env),
      ],
    );
  }
}

export class PgTaskRepository implements TaskRepository {
  constructor(private readonly pool: SqlPool) {}

  private async inTx<T>(ctx: RepoContext, fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const client: SqlClient = guardClient(await this.pool.connect());
    try {
      await client.query('BEGIN');
      try {
        for (const [name, value] of Object.entries(dbSessionSettings(ctx))) {
          await client.query('SELECT set_config($1, $2, true)', [name, value]);
        }
        const out = await fn(new PgTx(client, ctx.tenant_id));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw mapPgError(err);
      }
    } finally {
      client.release();
    }
  }

  read<T>(ctx: RepoContext, fn: (tx: TaskReadTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }

  write<T>(ctx: RepoContext, fn: (tx: TaskWriteTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }
}
