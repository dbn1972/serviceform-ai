import { dbSessionSettings, type EventEnvelope } from '../contracts.js';
import type { AppellateAuthority } from '../domain/authority.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { AdmissibilityCode, AppealState, NoteKind, Operation } from '../domain/states.js';
import { Cmp028Error, mapPgError } from '../errors.js';
import { guardClient, type SqlClient, type SqlPool, type SqlQueryable } from '../sql.js';
import { runInDomainTransaction } from '../tx-scope.js';
import type {
  AppealPatch,
  AppealReadTx,
  AppealRepository,
  AppealRow,
  AppealWriteTx,
  AssistNoteRow,
  HistoryRow,
  NewAppeal,
  NewHistory,
  RepoContext,
  StoredIdempotent,
} from './types.js';

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const SQL_GET_APPEAL = `SELECT tenant_id, appeal_id, original_application_id, original_case_id,
         original_decision_id, cell_id, appeal_state, grounds_code, evidence_refs,
         admissibility_code, admissibility_reason_code, role_code, organisation_id, office_id,
         jurisdiction_id, service_scope_id, workflow_instance_id, workflow_version_id, hearing_ref,
         review_ref, decision_ref, original_case_command_ref, created_by, correlation_id,
         aggregate_version, created_at, updated_at
    FROM sf_appeal.appeal WHERE tenant_id = $1 AND appeal_id = $2`;
const SQL_LOCK_APPEAL = `${SQL_GET_APPEAL} FOR UPDATE`;

function toAuthority(row: Row): AppellateAuthority {
  return {
    role_code: String(row['role_code']),
    organisation_id: String(row['organisation_id']),
    office_id: strOrNull(row['office_id']),
    jurisdiction_id: String(row['jurisdiction_id']),
    service_scope_id: strOrNull(row['service_scope_id']),
  };
}

function uuidArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

export function toAppeal(row: Row): AppealRow {
  return {
    tenant_id: String(row['tenant_id']),
    appeal_id: String(row['appeal_id']),
    original_application_id: String(row['original_application_id']),
    original_case_id: strOrNull(row['original_case_id']),
    original_decision_id: strOrNull(row['original_decision_id']),
    cell_id: String(row['cell_id']),
    appeal_state: row['appeal_state'] as AppealState,
    grounds_code: String(row['grounds_code']),
    evidence_refs: uuidArray(row['evidence_refs']),
    admissibility_code: row['admissibility_code'] as AdmissibilityCode,
    admissibility_reason_code: strOrNull(row['admissibility_reason_code']),
    authority: toAuthority(row),
    workflow_instance_id: strOrNull(row['workflow_instance_id']),
    workflow_version_id: strOrNull(row['workflow_version_id']),
    hearing_ref: strOrNull(row['hearing_ref']),
    review_ref: strOrNull(row['review_ref']),
    decision_ref: strOrNull(row['decision_ref']),
    original_case_command_ref: strOrNull(row['original_case_command_ref']),
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
    appeal_id: String(row['appeal_id']),
    seq: Number(row['seq']),
    operation: row['operation'] as Operation,
    from_state: (row['from_state'] as AppealState | null) ?? null,
    to_state: row['to_state'] as AppealState,
    actor_type: String(row['actor_type']),
    actor_id: String(row['actor_id']),
    authority: toAuthority(row),
    admissibility_code: (row['admissibility_code'] as AdmissibilityCode | null) ?? null,
    review_ref: strOrNull(row['review_ref']),
    hearing_ref: strOrNull(row['hearing_ref']),
    decision_ref: strOrNull(row['decision_ref']),
    authz_decision_id: String(row['authz_decision_id']),
    policy_revision: String(row['policy_revision']),
    idempotency_key: String(row['idempotency_key']),
    correlation_id: String(row['correlation_id']),
    occurred_at: iso(row['occurred_at']),
  };
}

class PgTx implements AppealWriteTx, AppealReadTx {
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
      `INSERT INTO sf_appeal.idempotency_record (
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
         FROM sf_appeal.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp028Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp028Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp028Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_appeal.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async getAppeal(appealId: string): Promise<AppealRow | null> {
    const r = await this.c.query(SQL_GET_APPEAL, [this.tenantId, appealId]);
    return r.rows[0] ? toAppeal(r.rows[0]) : null;
  }

  async lockAppeal(appealId: string): Promise<AppealRow | null> {
    const r = await this.c.query(SQL_LOCK_APPEAL, [this.tenantId, appealId]);
    return r.rows[0] ? toAppeal(r.rows[0]) : null;
  }

  async listHistory(appealId: string): Promise<HistoryRow[]> {
    const r = await this.c.query(
      `SELECT history_id, appeal_id, seq, operation, from_state, to_state, actor_type, actor_id,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         admissibility_code, review_ref, hearing_ref, decision_ref, authz_decision_id,
         policy_revision, idempotency_key, correlation_id, occurred_at
         FROM sf_appeal.appeal_history WHERE tenant_id = $1 AND appeal_id = $2 ORDER BY seq`,
      [this.tenantId, appealId],
    );
    return r.rows.map(toHistory);
  }

  async listNotes(appealId: string): Promise<AssistNoteRow[]> {
    const r = await this.c.query(
      `SELECT note_id, appeal_id, note_kind, content_ref, created_by, created_at
         FROM sf_appeal.assist_note WHERE tenant_id = $1 AND appeal_id = $2 ORDER BY created_at`,
      [this.tenantId, appealId],
    );
    return r.rows.map((row) => ({
      note_id: String(row['note_id']),
      appeal_id: String(row['appeal_id']),
      note_kind: row['note_kind'] as NoteKind,
      content_ref: String(row['content_ref']),
      created_by: String(row['created_by']),
      created_at: iso(row['created_at']),
    }));
  }

  async insertAppeal(t: NewAppeal): Promise<AppealRow> {
    const a = t.authority;
    const r = await this.c.query(
      `INSERT INTO sf_appeal.appeal (
         tenant_id, appeal_id, original_application_id, original_case_id, original_decision_id,
         cell_id, appeal_state, grounds_code, evidence_refs, admissibility_code,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         created_by, correlation_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'FILED',$7,$8::uuid[],'PENDING',$9,$10,$11,$12,$13,$14,$15,$16,$16)
       RETURNING tenant_id, appeal_id, original_application_id, original_case_id, original_decision_id,
         cell_id, appeal_state, grounds_code, evidence_refs, admissibility_code, admissibility_reason_code,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         workflow_instance_id, workflow_version_id, hearing_ref, review_ref, decision_ref,
         original_case_command_ref, created_by, correlation_id, aggregate_version, created_at, updated_at`,
      [
        this.tenantId,
        t.appeal_id,
        t.original_application_id,
        t.original_case_id,
        t.original_decision_id,
        t.cell_id,
        t.grounds_code,
        t.evidence_refs,
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
    return toAppeal(r.rows[0] as Row);
  }

  async updateAppeal(appealId: string, p: AppealPatch): Promise<AppealRow> {
    const a = p.authority;
    const r = await this.c.query(
      `UPDATE sf_appeal.appeal
          SET appeal_state = $3, admissibility_code = $4, admissibility_reason_code = $5,
              role_code = $6, organisation_id = $7, office_id = $8, jurisdiction_id = $9,
              service_scope_id = $10, workflow_instance_id = $11, workflow_version_id = $12,
              hearing_ref = $13, review_ref = $14, decision_ref = $15,
              original_case_command_ref = $16, original_case_id = $17, original_decision_id = $18,
              evidence_refs = $19::uuid[], aggregate_version = aggregate_version + 1, updated_at = $20
        WHERE tenant_id = $1 AND appeal_id = $2 AND aggregate_version = $21
        RETURNING tenant_id, appeal_id, original_application_id, original_case_id, original_decision_id,
          cell_id, appeal_state, grounds_code, evidence_refs, admissibility_code, admissibility_reason_code,
          role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
          workflow_instance_id, workflow_version_id, hearing_ref, review_ref, decision_ref,
          original_case_command_ref, created_by, correlation_id, aggregate_version, created_at, updated_at`,
      [
        this.tenantId,
        appealId,
        p.appeal_state,
        p.admissibility_code,
        p.admissibility_reason_code,
        a.role_code,
        a.organisation_id,
        a.office_id,
        a.jurisdiction_id,
        a.service_scope_id,
        p.workflow_instance_id,
        p.workflow_version_id,
        p.hearing_ref,
        p.review_ref,
        p.decision_ref,
        p.original_case_command_ref,
        p.original_case_id,
        p.original_decision_id,
        p.evidence_refs,
        p.now.toISOString(),
        p.expected_version,
      ],
    );
    if (!r.rows[0]) throw new Cmp028Error('SF-APP-001');
    return toAppeal(r.rows[0]);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const a = h.authority;
    const r = await this.c.query(
      `INSERT INTO sf_appeal.appeal_history (
         tenant_id, history_id, appeal_id, seq, operation, from_state, to_state, actor_type, actor_id,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         admissibility_code, review_ref, hearing_ref, decision_ref, authz_decision_id, policy_revision,
         idempotency_key, correlation_id, occurred_at
       ) VALUES (
         $1,$2,$3,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM sf_appeal.appeal_history WHERE tenant_id = $1 AND appeal_id = $3),
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING history_id, appeal_id, seq, operation, from_state, to_state, actor_type, actor_id,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         admissibility_code, review_ref, hearing_ref, decision_ref, authz_decision_id,
         policy_revision, idempotency_key, correlation_id, occurred_at`,
      [
        this.tenantId,
        h.history_id,
        h.appeal_id,
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
        h.admissibility_code,
        h.review_ref,
        h.hearing_ref,
        h.decision_ref,
        h.authz_decision_id,
        h.policy_revision,
        h.idempotency_key,
        h.correlation_id,
        h.now.toISOString(),
      ],
    );
    return toHistory(r.rows[0] as Row);
  }

  async insertNote(row: {
    note_id: string;
    appeal_id: string;
    note_kind: NoteKind;
    content_ref: string;
    created_by: string;
    correlation_id: string;
    now: Date;
  }): Promise<AssistNoteRow> {
    const r = await this.c.query(
      `INSERT INTO sf_appeal.assist_note (
         tenant_id, note_id, appeal_id, note_kind, content_ref, created_by, correlation_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING note_id, appeal_id, note_kind, content_ref, created_by, created_at`,
      [
        this.tenantId,
        row.note_id,
        row.appeal_id,
        row.note_kind,
        row.content_ref,
        row.created_by,
        row.correlation_id,
        row.now.toISOString(),
      ],
    );
    const n = r.rows[0] as Row;
    return {
      note_id: String(n['note_id']),
      appeal_id: String(n['appeal_id']),
      note_kind: n['note_kind'] as NoteKind,
      content_ref: String(n['content_ref']),
      created_by: String(n['created_by']),
      created_at: iso(n['created_at']),
    };
  }

  async insertOutbox(env: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_appeal.outbox_event (
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

export class PgAppealRepository implements AppealRepository {
  constructor(private readonly pool: SqlPool) {}

  private async inTx<T>(ctx: RepoContext, fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const client: SqlClient = guardClient(await this.pool.connect());
    try {
      await client.query('BEGIN');
      try {
        return await runInDomainTransaction(async () => {
          for (const [name, value] of Object.entries(dbSessionSettings(ctx))) {
            await client.query('SELECT set_config($1, $2, true)', [name, value]);
          }
          const out = await fn(new PgTx(client, ctx.tenant_id));
          await client.query('COMMIT');
          return out;
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw mapPgError(err);
      }
    } finally {
      client.release();
    }
  }

  read<T>(ctx: RepoContext, fn: (tx: AppealReadTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }

  write<T>(ctx: RepoContext, fn: (tx: AppealWriteTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }
}
