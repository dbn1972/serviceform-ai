import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp019Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  DeficiencyRepository,
  DeficiencyTx,
  EffectStatus,
  EvidenceRow,
  HistoryRow,
  ItemRow,
  NoticeRow,
  ReconciliationIntentRow,
  ResponseRow,
  StoredIdempotent,
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

function toNotice(r: Record<string, unknown>): NoticeRow {
  return {
    tenant_id: String(r['tenant_id']),
    deficiency_id: String(r['deficiency_id']),
    application_id: String(r['application_id']),
    cell_id: String(r['cell_id']),
    status: r['status'] as NoticeRow['status'],
    reason_code: String(r['reason_code']),
    notice_code: String(r['notice_code']),
    instruction_ref: String(r['instruction_ref']),
    sla_pause_reason_code: String(r['sla_pause_reason_code']),
    sla_stage_code: String(r['sla_stage_code']),
    response_due_at: isoOrNull(r['response_due_at']),
    opened_at: iso(r['opened_at']),
    responded_at: isoOrNull(r['responded_at']),
    closed_at: isoOrNull(r['closed_at']),
    close_reason_code: strOrNull(r['close_reason_code']),
    opened_by: String(r['opened_by']),
    closed_by: strOrNull(r['closed_by']),
    correlation_id: String(r['correlation_id']),
    aggregate_version: num(r['aggregate_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

function toItem(r: Record<string, unknown>): ItemRow {
  return {
    deficiency_id: String(r['deficiency_id']),
    item_seq: num(r['item_seq']),
    item_code: String(r['item_code']),
    evidence_requirement_ref: strOrNull(r['evidence_requirement_ref']),
    required: Boolean(r['required']),
    item_status: r['item_status'] as ItemRow['item_status'],
  };
}

const NOTICE_COLS = `tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
  instruction_ref, sla_pause_reason_code, sla_stage_code, response_due_at, opened_at, responded_at,
  closed_at, close_reason_code, opened_by, closed_by, correlation_id, aggregate_version, created_at, updated_at`;
const SELECT_NOTICE = `SELECT ${NOTICE_COLS} FROM sf_deficiency.deficiency_notice`;

class PgTx implements DeficiencyTx {
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
      `INSERT INTO sf_deficiency.idempotency_record (
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
         FROM sf_deficiency.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp019Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp019Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp019Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_deficiency.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertNotice(row: NoticeRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.deficiency_notice (
         tenant_id, deficiency_id, application_id, cell_id, status, reason_code, notice_code,
         instruction_ref, sla_pause_reason_code, sla_stage_code, response_due_at, opened_at,
         opened_by, correlation_id, aggregate_version, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        row.tenant_id,
        row.deficiency_id,
        row.application_id,
        row.cell_id,
        row.status,
        row.reason_code,
        row.notice_code,
        row.instruction_ref,
        row.sla_pause_reason_code,
        row.sla_stage_code,
        row.response_due_at,
        row.opened_at,
        row.opened_by,
        row.correlation_id,
        row.aggregate_version,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async updateNotice(row: NoticeRow): Promise<void> {
    await this.c.query(
      `UPDATE sf_deficiency.deficiency_notice SET
         status = $3, responded_at = $4, closed_at = $5, close_reason_code = $6,
         closed_by = $7, aggregate_version = $8, updated_at = $9
       WHERE tenant_id = $1 AND deficiency_id = $2`,
      [
        row.tenant_id,
        row.deficiency_id,
        row.status,
        row.responded_at,
        row.closed_at,
        row.close_reason_code,
        row.closed_by,
        row.aggregate_version,
        row.updated_at,
      ],
    );
  }

  async getNotice(id: string): Promise<NoticeRow | undefined> {
    const r = await this.c.query(
      SELECT_NOTICE + ' WHERE tenant_id = $1 AND deficiency_id = $2 FOR UPDATE',
      [this.tenantId, id],
    );
    const row = r.rows[0];
    return row ? toNotice(row) : undefined;
  }

  async findActiveByApplication(applicationId: string): Promise<NoticeRow | undefined> {
    const r = await this.c.query(
      SELECT_NOTICE +
        " WHERE tenant_id = $1 AND application_id = $2 AND status IN ('OPEN','RESPONSE_RECEIVED') FOR UPDATE",
      [this.tenantId, applicationId],
    );
    const row = r.rows[0];
    return row ? toNotice(row) : undefined;
  }

  async listByApplication(applicationId: string): Promise<NoticeRow[]> {
    const r = await this.c.query(
      SELECT_NOTICE +
        ' WHERE tenant_id = $1 AND application_id = $2 ORDER BY opened_at, deficiency_id',
      [this.tenantId, applicationId],
    );
    return r.rows.map(toNotice);
  }

  async insertItem(row: ItemRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.requested_item (
         tenant_id, deficiency_id, item_seq, item_code, evidence_requirement_ref, required, item_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        this.tenantId,
        row.deficiency_id,
        row.item_seq,
        row.item_code,
        row.evidence_requirement_ref,
        row.required,
        row.item_status,
      ],
    );
  }

  async markItemsProvided(deficiencyId: string, codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    await this.c.query(
      `UPDATE sf_deficiency.requested_item SET item_status = 'PROVIDED'
        WHERE tenant_id = $1 AND deficiency_id = $2 AND item_code = ANY($3::text[])`,
      [this.tenantId, deficiencyId, codes],
    );
  }

  async listItems(deficiencyId: string): Promise<ItemRow[]> {
    const r = await this.c.query(
      `SELECT deficiency_id, item_seq, item_code, evidence_requirement_ref, required, item_status
         FROM sf_deficiency.requested_item
        WHERE tenant_id = $1 AND deficiency_id = $2 ORDER BY item_seq`,
      [this.tenantId, deficiencyId],
    );
    return r.rows.map(toItem);
  }

  async insertResponse(row: ResponseRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.citizen_response (
         tenant_id, response_id, deficiency_id, narrative_ref, responded_at, actor_id, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        this.tenantId,
        row.response_id,
        row.deficiency_id,
        row.narrative_ref,
        row.responded_at,
        row.actor_id,
        row.correlation_id,
      ],
    );
  }

  async getResponse(deficiencyId: string): Promise<ResponseRow | undefined> {
    const r = await this.c.query(
      `SELECT response_id, deficiency_id, narrative_ref, responded_at, actor_id, correlation_id
         FROM sf_deficiency.citizen_response WHERE tenant_id = $1 AND deficiency_id = $2`,
      [this.tenantId, deficiencyId],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      response_id: String(row['response_id']),
      deficiency_id: String(row['deficiency_id']),
      narrative_ref: String(row['narrative_ref']),
      responded_at: iso(row['responded_at']),
      actor_id: String(row['actor_id']),
      correlation_id: String(row['correlation_id']),
    };
  }

  async insertEvidence(row: EvidenceRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.evidence_ref (
         tenant_id, link_id, deficiency_id, response_id, evidence_ref, kind_code, attached_by, attached_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        this.tenantId,
        row.link_id,
        row.deficiency_id,
        row.response_id,
        row.evidence_ref,
        row.kind_code,
        row.attached_by,
        row.attached_at,
      ],
    );
  }

  async listEvidence(deficiencyId: string): Promise<EvidenceRow[]> {
    const r = await this.c.query(
      `SELECT link_id, deficiency_id, response_id, evidence_ref, kind_code, attached_by, attached_at
         FROM sf_deficiency.evidence_ref WHERE tenant_id = $1 AND deficiency_id = $2 ORDER BY attached_at`,
      [this.tenantId, deficiencyId],
    );
    return r.rows.map((row) => ({
      link_id: String(row['link_id']),
      deficiency_id: String(row['deficiency_id']),
      response_id: strOrNull(row['response_id']),
      evidence_ref: String(row['evidence_ref']),
      kind_code: String(row['kind_code']),
      attached_by: String(row['attached_by']),
      attached_at: iso(row['attached_at']),
    }));
  }

  async appendHistory(row: HistoryRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.deficiency_event (
         tenant_id, deficiency_id, sequence_no, operation, from_status, to_status, occurred_at,
         reason_code, actor_type, actor_id, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        this.tenantId,
        row.deficiency_id,
        row.sequence_no,
        row.operation,
        row.from_status,
        row.to_status,
        row.occurred_at,
        row.reason_code,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
      ],
    );
  }

  async listHistory(deficiencyId: string): Promise<HistoryRow[]> {
    const r = await this.c.query(
      `SELECT deficiency_id, sequence_no, operation, from_status, to_status, occurred_at,
              reason_code, actor_type, actor_id, correlation_id
         FROM sf_deficiency.deficiency_event
        WHERE tenant_id = $1 AND deficiency_id = $2 ORDER BY sequence_no`,
      [this.tenantId, deficiencyId],
    );
    return r.rows.map((row) => ({
      deficiency_id: String(row['deficiency_id']),
      sequence_no: num(row['sequence_no']),
      operation: row['operation'] as HistoryRow['operation'],
      from_status: (row['from_status'] as HistoryRow['from_status']) ?? null,
      to_status: row['to_status'] as HistoryRow['to_status'],
      occurred_at: iso(row['occurred_at']),
      reason_code: strOrNull(row['reason_code']),
      actor_type: String(row['actor_type']),
      actor_id: String(row['actor_id']),
      correlation_id: String(row['correlation_id']),
    }));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.outbox_event (
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

  async insertReconciliationIntent(row: ReconciliationIntentRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_deficiency.reconciliation_intent (
         tenant_id, intent_id, deficiency_id, application_id, cell_id, correlation_id,
         source_event_id, operation,
         case_command, case_expected_state, case_expected_version, case_reason_code,
         case_idempotency_key, case_effect_status,
         sla_kind, sla_stage_code, sla_reason_code, sla_idempotency_key, sla_effect_status,
         notification_kind, notification_effect_status, last_error_code, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
       )`,
      [
        row.tenant_id,
        row.intent_id,
        row.deficiency_id,
        row.application_id,
        row.cell_id,
        row.correlation_id,
        row.source_event_id,
        row.operation,
        row.case_command,
        row.case_expected_state,
        row.case_expected_version,
        row.case_reason_code,
        row.case_idempotency_key,
        row.case_effect_status,
        row.sla_kind,
        row.sla_stage_code,
        row.sla_reason_code,
        row.sla_idempotency_key,
        row.sla_effect_status,
        row.notification_kind,
        row.notification_effect_status,
        row.last_error_code,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async getReconciliationIntent(intentId: string): Promise<ReconciliationIntentRow | undefined> {
    const r = await this.c.query(
      `SELECT tenant_id, intent_id, deficiency_id, application_id, cell_id, correlation_id,
              source_event_id, operation,
              case_command, case_expected_state, case_expected_version, case_reason_code,
              case_idempotency_key, case_effect_status,
              sla_kind, sla_stage_code, sla_reason_code, sla_idempotency_key, sla_effect_status,
              notification_kind, notification_effect_status, last_error_code, created_at, updated_at
         FROM sf_deficiency.reconciliation_intent
        WHERE tenant_id = $1 AND intent_id = $2`,
      [this.tenantId, intentId],
    );
    const row = r.rows[0];
    return row ? toIntent(row) : undefined;
  }

  async listPendingReconciliationIntents(limit: number): Promise<ReconciliationIntentRow[]> {
    const r = await this.c.query(
      `SELECT tenant_id, intent_id, deficiency_id, application_id, cell_id, correlation_id,
              source_event_id, operation,
              case_command, case_expected_state, case_expected_version, case_reason_code,
              case_idempotency_key, case_effect_status,
              sla_kind, sla_stage_code, sla_reason_code, sla_idempotency_key, sla_effect_status,
              notification_kind, notification_effect_status, last_error_code, created_at, updated_at
         FROM sf_deficiency.reconciliation_intent
        WHERE tenant_id = $1
          AND (
            case_effect_status IN ('PENDING', 'FAILED_RETRYABLE')
            OR sla_effect_status IN ('PENDING', 'FAILED_RETRYABLE')
            OR notification_effect_status IN ('PENDING', 'FAILED_RETRYABLE')
          )
        ORDER BY created_at ASC
        LIMIT $2`,
      [this.tenantId, limit],
    );
    return r.rows.map(toIntent);
  }

  async updateReconciliationEffects(p: {
    intentId: string;
    case_effect_status?: EffectStatus;
    sla_effect_status?: EffectStatus;
    notification_effect_status?: EffectStatus;
    last_error_code?: string | null;
    now: Date;
  }): Promise<void> {
    const sets: string[] = ['updated_at = $3'];
    const vals: unknown[] = [this.tenantId, p.intentId, p.now.toISOString()];
    if (p.case_effect_status !== undefined) {
      vals.push(p.case_effect_status);
      sets.push(`case_effect_status = $${String(vals.length)}`);
    }
    if (p.sla_effect_status !== undefined) {
      vals.push(p.sla_effect_status);
      sets.push(`sla_effect_status = $${String(vals.length)}`);
    }
    if (p.notification_effect_status !== undefined) {
      vals.push(p.notification_effect_status);
      sets.push(`notification_effect_status = $${String(vals.length)}`);
    }
    if (p.last_error_code !== undefined) {
      vals.push(p.last_error_code);
      sets.push(`last_error_code = $${String(vals.length)}`);
    }
    await this.c.query(
      `UPDATE sf_deficiency.reconciliation_intent SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND intent_id = $2`,
      vals,
    );
  }

  async hasInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.c.query(
      `SELECT 1 FROM sf_deficiency.inbox_event
        WHERE tenant_id = $1 AND consumer_group = $2 AND event_id = $3`,
      [this.tenantId, consumerGroup, eventId],
    );
    return r.rows.length > 0;
  }

  async recordInbox(consumerGroup: string, eventId: string): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_deficiency.inbox_event (consumer_group, event_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer_group, event_id) DO NOTHING`,
      [consumerGroup, eventId, this.tenantId],
    );
    return (r.rowCount ?? 0) === 1;
  }
}

function toIntent(r: Record<string, unknown>): ReconciliationIntentRow {
  return {
    tenant_id: String(r['tenant_id']),
    intent_id: String(r['intent_id']),
    deficiency_id: String(r['deficiency_id']),
    application_id: String(r['application_id']),
    cell_id: String(r['cell_id']),
    correlation_id: String(r['correlation_id']),
    source_event_id: String(r['source_event_id']),
    operation: r['operation'] as ReconciliationIntentRow['operation'],
    case_command: (r['case_command'] as ReconciliationIntentRow['case_command']) ?? null,
    case_expected_state: strOrNull(r['case_expected_state']),
    case_expected_version:
      r['case_expected_version'] === null || r['case_expected_version'] === undefined
        ? null
        : num(r['case_expected_version']),
    case_reason_code: strOrNull(r['case_reason_code']),
    case_idempotency_key: strOrNull(r['case_idempotency_key']),
    case_effect_status: r['case_effect_status'] as EffectStatus,
    sla_kind: (r['sla_kind'] as ReconciliationIntentRow['sla_kind']) ?? null,
    sla_stage_code: strOrNull(r['sla_stage_code']),
    sla_reason_code: strOrNull(r['sla_reason_code']),
    sla_idempotency_key: strOrNull(r['sla_idempotency_key']),
    sla_effect_status: r['sla_effect_status'] as EffectStatus,
    notification_kind:
      (r['notification_kind'] as ReconciliationIntentRow['notification_kind']) ?? null,
    notification_effect_status: r['notification_effect_status'] as EffectStatus,
    last_error_code: strOrNull(r['last_error_code']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

export class PgDeficiencyRepository implements DeficiencyRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: DeficiencyTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp019Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
