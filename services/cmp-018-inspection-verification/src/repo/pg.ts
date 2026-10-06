import { dbSessionSettings, type EventEnvelope } from '../contracts.js';
import type { Assignment } from '../domain/assignment.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { PrincipalScope } from '../domain/resolution.js';
import type { VerificationResult } from '../domain/result.js';
import type { InspectionState } from '../domain/states.js';
import { Cmp018Error, mapPgError } from '../errors.js';
import type { TechnicalAcceptance } from '../ports/evidence.js';
import { guardClient, type SqlClient, type SqlPool, type SqlQueryable } from '../sql.js';
import { runInDomainTransaction } from '../tx-scope.js';
import type {
  ChecklistRow,
  EvidenceRefRow,
  FindingRow,
  HistoryRow,
  InspectionPatch,
  InspectionReadTx,
  InspectionRepository,
  InspectionRow,
  InspectionWriteTx,
  NewHistory,
  NewInspection,
  ObservationRow,
  RepoContext,
  ScheduleMetaView,
  StoredIdempotent,
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

function toSchedule(row: Row): ScheduleMetaView {
  return {
    window_start: row['window_start'] ? iso(row['window_start']) : null,
    window_end: row['window_end'] ? iso(row['window_end']) : null,
    slot_ref: strOrNull(row['slot_ref']),
    location_ref: strOrNull(row['location_ref']),
    timezone_iana: strOrNull(row['timezone_iana']),
  };
}

const SELECT_INSPECTION = `tenant_id, inspection_id, application_id, prior_inspection_id, workflow_node_id, cell_id,
  inspection_state, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
  claimed_principal_id, claimed_at, window_start, window_end, slot_ref, location_ref, timezone_iana,
  verification_result, statutory_effect, created_by, correlation_id, aggregate_version, created_at, updated_at`;

export function toInspection(row: Row): InspectionRow {
  return {
    tenant_id: String(row['tenant_id']),
    inspection_id: String(row['inspection_id']),
    application_id: String(row['application_id']),
    prior_inspection_id: strOrNull(row['prior_inspection_id']),
    workflow_node_id: strOrNull(row['workflow_node_id']),
    cell_id: String(row['cell_id']),
    inspection_state: row['inspection_state'] as InspectionState,
    assignment: toAssignment(row),
    claimed_principal_id: strOrNull(row['claimed_principal_id']),
    claimed_at: row['claimed_at'] ? iso(row['claimed_at']) : null,
    schedule: toSchedule(row),
    verification_result: (row['verification_result'] as VerificationResult | null) ?? null,
    statutory_effect: false,
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
    inspection_id: String(row['inspection_id']),
    seq: Number(row['seq']),
    operation: row['operation'] as HistoryRow['operation'],
    from_state: (row['from_state'] as InspectionState | null) ?? null,
    to_state: row['to_state'] as InspectionState,
    actor_type: String(row['actor_type']),
    actor_id: String(row['actor_id']),
    assignment: toAssignment(row),
    claimed_principal_id: strOrNull(row['claimed_principal_id']),
    verification_result: (row['verification_result'] as VerificationResult | null) ?? null,
    statutory_effect: false,
    authz_decision_id: String(row['authz_decision_id']),
    policy_revision: String(row['policy_revision']),
    idempotency_key: String(row['idempotency_key']),
    correlation_id: String(row['correlation_id']),
    occurred_at: iso(row['occurred_at']),
  };
}

class PgTx implements InspectionWriteTx, InspectionReadTx {
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
      `INSERT INTO sf_inspection.idempotency_record (
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
         FROM sf_inspection.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp018Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp018Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp018Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_inspection.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async getInspection(inspectionId: string): Promise<InspectionRow | null> {
    const r = await this.c.query(
      'SELECT ' +
        SELECT_INSPECTION +
        ' FROM sf_inspection.inspection WHERE tenant_id = $1 AND inspection_id = $2',
      [this.tenantId, inspectionId],
    );
    return r.rows[0] ? toInspection(r.rows[0]) : null;
  }

  async lockInspection(inspectionId: string): Promise<InspectionRow | null> {
    const r = await this.c.query(
      'SELECT ' +
        SELECT_INSPECTION +
        ' FROM sf_inspection.inspection WHERE tenant_id = $1 AND inspection_id = $2 FOR UPDATE',
      [this.tenantId, inspectionId],
    );
    return r.rows[0] ? toInspection(r.rows[0]) : null;
  }

  async listAvailable(scope: PrincipalScope, limit: number): Promise<InspectionRow[]> {
    const r = await this.c.query(
      'SELECT ' +
        SELECT_INSPECTION +
        ` FROM sf_inspection.inspection
        WHERE tenant_id = $1 AND inspection_state IN ('REQUESTED', 'SCHEDULED')
          AND role_code = ANY($2::text[])
          AND organisation_id = ANY($3::uuid[])
          AND (office_id IS NULL OR office_id = ANY($4::uuid[]))
          AND jurisdiction_id = ANY($5::uuid[])
          AND (service_scope_id IS NULL OR service_scope_id = ANY($6::uuid[]))
        ORDER BY created_at, inspection_id
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
    return r.rows.map(toInspection);
  }

  async listHistory(inspectionId: string): Promise<HistoryRow[]> {
    const r = await this.c.query(
      `SELECT history_id, inspection_id, seq, operation, from_state, to_state, actor_type,
         actor_id, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, verification_result, statutory_effect, authz_decision_id,
         policy_revision, idempotency_key, correlation_id, occurred_at
         FROM sf_inspection.inspection_history
        WHERE tenant_id = $1 AND inspection_id = $2 ORDER BY seq`,
      [this.tenantId, inspectionId],
    );
    return r.rows.map(toHistory);
  }

  async listChecklist(inspectionId: string): Promise<ChecklistRow[]> {
    const r = await this.c.query(
      `SELECT item_id, inspection_id, item_code, required, item_state
         FROM sf_inspection.checklist_item WHERE tenant_id = $1 AND inspection_id = $2
         ORDER BY item_code`,
      [this.tenantId, inspectionId],
    );
    return r.rows.map((row) => ({
      item_id: String(row['item_id']),
      inspection_id: String(row['inspection_id']),
      item_code: String(row['item_code']),
      required: Boolean(row['required']),
      item_state: String(row['item_state']),
    }));
  }

  async listObservations(inspectionId: string): Promise<ObservationRow[]> {
    const r = await this.c.query(
      `SELECT observation_id, inspection_id, item_code, note_ref, geo_ref, captured_at, actor_id
         FROM sf_inspection.observation WHERE tenant_id = $1 AND inspection_id = $2
         ORDER BY captured_at, observation_id`,
      [this.tenantId, inspectionId],
    );
    return r.rows.map((row) => ({
      observation_id: String(row['observation_id']),
      inspection_id: String(row['inspection_id']),
      item_code: String(row['item_code']),
      note_ref: String(row['note_ref']),
      geo_ref: strOrNull(row['geo_ref']),
      captured_at: iso(row['captured_at']),
      actor_id: String(row['actor_id']),
    }));
  }

  async listEvidence(inspectionId: string): Promise<EvidenceRefRow[]> {
    const r = await this.c.query(
      `SELECT evidence_ref_id, inspection_id, evidence_id, document_id, ocr_job_id,
         technical_acceptance, simulation_marker
         FROM sf_inspection.evidence_ref WHERE tenant_id = $1 AND inspection_id = $2
         ORDER BY evidence_ref_id`,
      [this.tenantId, inspectionId],
    );
    return r.rows.map((row) => ({
      evidence_ref_id: String(row['evidence_ref_id']),
      inspection_id: String(row['inspection_id']),
      evidence_id: strOrNull(row['evidence_id']),
      document_id: strOrNull(row['document_id']),
      ocr_job_id: strOrNull(row['ocr_job_id']),
      technical_acceptance: row['technical_acceptance'] as TechnicalAcceptance,
      simulation_marker: (row['simulation_marker'] as Record<string, unknown> | null) ?? null,
    }));
  }

  async listFindings(inspectionId: string): Promise<FindingRow[]> {
    const r = await this.c.query(
      `SELECT finding_id, inspection_id, finding_code, severity, related_item_code
         FROM sf_inspection.finding WHERE tenant_id = $1 AND inspection_id = $2
         ORDER BY finding_id`,
      [this.tenantId, inspectionId],
    );
    return r.rows.map((row) => ({
      finding_id: String(row['finding_id']),
      inspection_id: String(row['inspection_id']),
      finding_code: String(row['finding_code']),
      severity: String(row['severity']),
      related_item_code: strOrNull(row['related_item_code']),
    }));
  }

  async insertInspection(t: NewInspection): Promise<InspectionRow> {
    const a = t.assignment;
    const r = await this.c.query(
      `INSERT INTO sf_inspection.inspection (
         tenant_id, inspection_id, application_id, prior_inspection_id, workflow_node_id, cell_id,
         inspection_state, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         created_by, correlation_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7,$8,$9,$10,$11,$12,$13,$14,$14)
       RETURNING ` + SELECT_INSPECTION,
      [
        this.tenantId,
        t.inspection_id,
        t.application_id,
        t.prior_inspection_id,
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
    return toInspection(r.rows[0] as Row);
  }

  async updateInspection(inspectionId: string, p: InspectionPatch): Promise<InspectionRow> {
    const a = p.assignment;
    const s = p.schedule;
    const r = await this.c.query(
      `UPDATE sf_inspection.inspection
          SET inspection_state = $3, role_code = $4, organisation_id = $5, office_id = $6,
              jurisdiction_id = $7, service_scope_id = $8, claimed_principal_id = $9,
              claimed_at = $10, window_start = $11, window_end = $12, slot_ref = $13,
              location_ref = $14, timezone_iana = $15, verification_result = $16,
              aggregate_version = aggregate_version + 1, updated_at = $17
        WHERE tenant_id = $1 AND inspection_id = $2 AND aggregate_version = $18
        RETURNING ` + SELECT_INSPECTION,
      [
        this.tenantId,
        inspectionId,
        p.inspection_state,
        a.role_code,
        a.organisation_id,
        a.office_id,
        a.jurisdiction_id,
        a.service_scope_id,
        p.claimed_principal_id,
        p.claimed_at ? p.claimed_at.toISOString() : null,
        s.window_start ? s.window_start.toISOString() : null,
        s.window_end ? s.window_end.toISOString() : null,
        s.slot_ref,
        s.location_ref,
        s.timezone_iana,
        p.verification_result,
        p.now.toISOString(),
        p.expected_version,
      ],
    );
    if (!r.rows[0]) throw new Cmp018Error('SF-APP-001');
    return toInspection(r.rows[0]);
  }

  async insertHistory(h: NewHistory): Promise<HistoryRow> {
    const a = h.assignment;
    const r = await this.c.query(
      `INSERT INTO sf_inspection.inspection_history (
         tenant_id, history_id, inspection_id, seq, operation, from_state, to_state, actor_type, actor_id,
         role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, verification_result, statutory_effect, authz_decision_id, policy_revision,
         idempotency_key, correlation_id, occurred_at
       ) VALUES (
         $1,$2,$3,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM sf_inspection.inspection_history WHERE tenant_id = $1 AND inspection_id = $3),
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,$16,$17,$18,$19,$20
       ) RETURNING history_id, inspection_id, seq, operation, from_state, to_state, actor_type,
         actor_id, role_code, organisation_id, office_id, jurisdiction_id, service_scope_id,
         claimed_principal_id, verification_result, statutory_effect, authz_decision_id,
         policy_revision, idempotency_key, correlation_id, occurred_at`,
      [
        this.tenantId,
        h.history_id,
        h.inspection_id,
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
        h.verification_result,
        h.authz_decision_id,
        h.policy_revision,
        h.idempotency_key,
        h.correlation_id,
        h.now.toISOString(),
      ],
    );
    return toHistory(r.rows[0] as Row);
  }

  async upsertChecklistItem(row: {
    item_id: string;
    inspection_id: string;
    item_code: string;
    required: boolean;
    item_state: string;
    now: Date;
  }): Promise<ChecklistRow> {
    const r = await this.c.query(
      `INSERT INTO sf_inspection.checklist_item (
         tenant_id, item_id, inspection_id, item_code, required, item_state, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (tenant_id, inspection_id, item_code)
       DO UPDATE SET item_state = EXCLUDED.item_state, updated_at = EXCLUDED.updated_at
       RETURNING item_id, inspection_id, item_code, required, item_state`,
      [
        this.tenantId,
        row.item_id,
        row.inspection_id,
        row.item_code,
        row.required,
        row.item_state,
        row.now.toISOString(),
      ],
    );
    const x = r.rows[0] as Row;
    return {
      item_id: String(x['item_id']),
      inspection_id: String(x['inspection_id']),
      item_code: String(x['item_code']),
      required: Boolean(x['required']),
      item_state: String(x['item_state']),
    };
  }

  async insertObservation(row: {
    observation_id: string;
    inspection_id: string;
    item_code: string;
    note_ref: string;
    geo_ref: string | null;
    captured_at: Date;
    actor_id: string;
  }): Promise<ObservationRow> {
    const r = await this.c.query(
      `INSERT INTO sf_inspection.observation (
         tenant_id, observation_id, inspection_id, item_code, note_ref, geo_ref, captured_at, actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING observation_id, inspection_id, item_code, note_ref, geo_ref, captured_at, actor_id`,
      [
        this.tenantId,
        row.observation_id,
        row.inspection_id,
        row.item_code,
        row.note_ref,
        row.geo_ref,
        row.captured_at.toISOString(),
        row.actor_id,
      ],
    );
    const x = r.rows[0] as Row;
    return {
      observation_id: String(x['observation_id']),
      inspection_id: String(x['inspection_id']),
      item_code: String(x['item_code']),
      note_ref: String(x['note_ref']),
      geo_ref: strOrNull(x['geo_ref']),
      captured_at: iso(x['captured_at']),
      actor_id: String(x['actor_id']),
    };
  }

  async insertEvidenceRef(row: {
    evidence_ref_id: string;
    inspection_id: string;
    evidence_id: string | null;
    document_id: string | null;
    ocr_job_id: string | null;
    technical_acceptance: TechnicalAcceptance;
    simulation_marker: Record<string, unknown> | null;
  }): Promise<EvidenceRefRow> {
    const r = await this.c.query(
      `INSERT INTO sf_inspection.evidence_ref (
         tenant_id, evidence_ref_id, inspection_id, evidence_id, document_id, ocr_job_id,
         technical_acceptance, simulation_marker
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING evidence_ref_id, inspection_id, evidence_id, document_id, ocr_job_id,
         technical_acceptance, simulation_marker`,
      [
        this.tenantId,
        row.evidence_ref_id,
        row.inspection_id,
        row.evidence_id,
        row.document_id,
        row.ocr_job_id,
        row.technical_acceptance,
        row.simulation_marker ? JSON.stringify(row.simulation_marker) : null,
      ],
    );
    const x = r.rows[0] as Row;
    return {
      evidence_ref_id: String(x['evidence_ref_id']),
      inspection_id: String(x['inspection_id']),
      evidence_id: strOrNull(x['evidence_id']),
      document_id: strOrNull(x['document_id']),
      ocr_job_id: strOrNull(x['ocr_job_id']),
      technical_acceptance: x['technical_acceptance'] as TechnicalAcceptance,
      simulation_marker: (x['simulation_marker'] as Record<string, unknown> | null) ?? null,
    };
  }

  async insertFinding(row: {
    finding_id: string;
    inspection_id: string;
    finding_code: string;
    severity: string;
    related_item_code: string | null;
  }): Promise<FindingRow> {
    const r = await this.c.query(
      `INSERT INTO sf_inspection.finding (
         tenant_id, finding_id, inspection_id, finding_code, severity, related_item_code
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING finding_id, inspection_id, finding_code, severity, related_item_code`,
      [
        this.tenantId,
        row.finding_id,
        row.inspection_id,
        row.finding_code,
        row.severity,
        row.related_item_code,
      ],
    );
    const x = r.rows[0] as Row;
    return {
      finding_id: String(x['finding_id']),
      inspection_id: String(x['inspection_id']),
      finding_code: String(x['finding_code']),
      severity: String(x['severity']),
      related_item_code: strOrNull(x['related_item_code']),
    };
  }

  async insertOutbox(env: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_inspection.outbox_event (
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

export class PgInspectionRepository implements InspectionRepository {
  constructor(private readonly pool: SqlPool) {}

  private async inTx<T>(ctx: RepoContext, fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const client: SqlClient = guardClient(await this.pool.connect());
    try {
      await client.query('BEGIN');
      try {
        for (const [name, value] of Object.entries(dbSessionSettings(ctx))) {
          await client.query('SELECT set_config($1, $2, true)', [name, value]);
        }
        const out = await runInDomainTransaction(() => fn(new PgTx(client, ctx.tenant_id)));
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

  read<T>(ctx: RepoContext, fn: (tx: InspectionReadTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }

  write<T>(ctx: RepoContext, fn: (tx: InspectionWriteTx) => Promise<T>): Promise<T> {
    return this.inTx(ctx, fn);
  }
}
