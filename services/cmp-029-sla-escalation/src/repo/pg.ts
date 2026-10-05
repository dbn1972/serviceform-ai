import { AsyncLocalStorage } from 'node:async_hooks';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { ClockState } from '../domain/clock.js';
import { Cmp029Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  CalendarRow,
  ClockRow,
  HistoryRow,
  PolicyRow,
  SlaRepository,
  SlaTx,
  StoredIdempotent,
} from './types.js';

/** Minimal driver surface (node-postgres compatible); the host supplies the pool. */
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
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const dateOnly = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

function toCalendar(r: Record<string, unknown>): CalendarRow {
  return {
    calendar_id: String(r['calendar_id']),
    calendar_code: String(r['calendar_code']),
    version_no: num(r['version_no']),
    utc_offset_minutes: num(r['utc_offset_minutes']),
    working_weekdays: (r['working_weekdays'] as unknown[]).map(Number),
    window_start_minute: num(r['window_start_minute']),
    window_end_minute: num(r['window_end_minute']),
    holidays: (r['holidays'] as unknown[]).map(dateOnly),
    effective_from: iso(r['effective_from']),
  };
}

function toPolicy(r: Record<string, unknown>): PolicyRow {
  return {
    policy_id: String(r['policy_id']),
    policy_code: String(r['policy_code']),
    version_no: num(r['version_no']),
    status: r['status'] as PolicyRow['status'],
    publication_ref: String(r['publication_ref']),
    start_anchor: String(r['start_anchor']),
    completion_anchor: String(r['completion_anchor']),
    calendar_id: String(r['calendar_id']),
    duration_basis: r['duration_basis'] as PolicyRow['duration_basis'],
    duration_minutes: num(r['duration_minutes']),
    warning_before_minutes: numOrNull(r['warning_before_minutes']),
    allowed_pause_reason_codes: r['allowed_pause_reason_codes'] as string[],
    escalation_schedule: r['escalation_schedule'] as PolicyRow['escalation_schedule'],
  };
}

function toClock(r: Record<string, unknown>): ClockRow {
  return {
    tenant_id: String(r['tenant_id']),
    clock_id: String(r['clock_id']),
    cell_id: String(r['cell_id']),
    application_id: String(r['application_id']),
    stage_code: String(r['stage_code']),
    policy_id: String(r['policy_id']),
    calendar_id: String(r['calendar_id']),
    start_anchor: String(r['start_anchor']),
    completion_anchor: String(r['completion_anchor']),
    anchor_event_ref: (r['anchor_event_ref'] as string | null) ?? null,
    status: r['status'] as ClockRow['status'],
    started_at: iso(r['started_at']),
    deadline_at: iso(r['deadline_at']),
    remaining_ms: numOrNull(r['remaining_ms']),
    paused_at: isoOrNull(r['paused_at']),
    pause_reason_code: (r['pause_reason_code'] as string | null) ?? null,
    pause_count: num(r['pause_count']),
    resumed_at: isoOrNull(r['resumed_at']),
    completed_at: isoOrNull(r['completed_at']),
    breach_at: isoOrNull(r['breach_at']),
    warning_emitted_at: isoOrNull(r['warning_emitted_at']),
    escalation_level: num(r['escalation_level']),
    aggregate_version: num(r['aggregate_version']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

function toHistory(r: Record<string, unknown>): HistoryRow {
  return {
    clock_id: String(r['clock_id']),
    sequence_no: num(r['sequence_no']),
    operation: r['operation'] as HistoryRow['operation'],
    from_status: (r['from_status'] as HistoryRow['from_status']) ?? null,
    to_status: r['to_status'] as HistoryRow['to_status'],
    occurred_at: iso(r['occurred_at']),
    reason_code: (r['reason_code'] as string | null) ?? null,
    deadline_before: isoOrNull(r['deadline_before']),
    deadline_after: iso(r['deadline_after']),
    remaining_ms: numOrNull(r['remaining_ms']),
    escalation_level: num(r['escalation_level']),
    actor_type: r['actor_type'] as HistoryRow['actor_type'],
    actor_id: String(r['actor_id']),
    correlation_id: String(r['correlation_id']),
  };
}

const CLOCK_COLUMNS = `tenant_id, clock_id, cell_id, application_id, stage_code, policy_id, calendar_id,
  start_anchor, completion_anchor, anchor_event_ref, status, started_at, deadline_at, remaining_ms,
  paused_at, pause_reason_code, pause_count, resumed_at, completed_at, breach_at, warning_emitted_at,
  escalation_level, aggregate_version, created_at, updated_at`;

const SELECT_CLOCK = `SELECT ${CLOCK_COLUMNS} FROM sf_sla.sla_clock`;
const SELECT_CLOCK_BY_ID = `${SELECT_CLOCK} WHERE tenant_id = $1 AND clock_id = $2`;
const LOCK_CLOCK_BY_ID = `${SELECT_CLOCK_BY_ID} FOR UPDATE`;
const SELECT_CLOCK_BY_STAGE = `${SELECT_CLOCK} WHERE tenant_id = $1 AND application_id = $2 AND stage_code = $3`;
const SELECT_CLOCKS_BY_APPLICATION = `${SELECT_CLOCK} WHERE tenant_id = $1 AND application_id = $2 ORDER BY created_at, clock_id`;

class PgTx implements SlaTx {
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
      `INSERT INTO sf_sla.idempotency_record (
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
         FROM sf_sla.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Cmp029Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp029Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp029Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_sla.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertCalendar(row: CalendarRow & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_sla.sla_calendar (
         tenant_id, calendar_id, calendar_code, version_no, utc_offset_minutes, working_weekdays,
         window_start_minute, window_end_minute, holidays, effective_from, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6::smallint[],$7,$8,$9::date[],$10,$11)`,
      [
        this.tenantId,
        row.calendar_id,
        row.calendar_code,
        row.version_no,
        row.utc_offset_minutes,
        row.working_weekdays,
        row.window_start_minute,
        row.window_end_minute,
        row.holidays,
        row.effective_from,
        row.created_by,
      ],
    );
  }

  async getCalendar(id: string): Promise<CalendarRow | null> {
    const r = await this.c.query(
      `SELECT calendar_id, calendar_code, version_no, utc_offset_minutes, working_weekdays,
              window_start_minute, window_end_minute, holidays, effective_from
         FROM sf_sla.sla_calendar WHERE tenant_id = $1 AND calendar_id = $2`,
      [this.tenantId, id],
    );
    return r.rows[0] ? toCalendar(r.rows[0]) : null;
  }

  async latestCalendarVersion(code: string): Promise<number> {
    const r = await this.c.query<{ v: string | number | null }>(
      `SELECT max(version_no) AS v FROM sf_sla.sla_calendar WHERE tenant_id = $1 AND calendar_code = $2`,
      [this.tenantId, code],
    );
    return numOrNull(r.rows[0]?.v) ?? 0;
  }

  async insertPolicy(row: PolicyRow & { created_by: string }): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_sla.sla_policy (
         tenant_id, policy_id, policy_code, version_no, status, publication_ref, start_anchor,
         completion_anchor, calendar_id, duration_basis, duration_minutes, warning_before_minutes,
         allowed_pause_reason_codes, escalation_schedule, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::jsonb,$15)`,
      [
        this.tenantId,
        row.policy_id,
        row.policy_code,
        row.version_no,
        row.status,
        row.publication_ref,
        row.start_anchor,
        row.completion_anchor,
        row.calendar_id,
        row.duration_basis,
        row.duration_minutes,
        row.warning_before_minutes,
        row.allowed_pause_reason_codes,
        JSON.stringify(row.escalation_schedule),
        row.created_by,
      ],
    );
  }

  async getPolicy(id: string): Promise<PolicyRow | null> {
    const r = await this.c.query(
      `SELECT policy_id, policy_code, version_no, status, publication_ref, start_anchor, completion_anchor,
              calendar_id, duration_basis, duration_minutes, warning_before_minutes,
              allowed_pause_reason_codes, escalation_schedule
         FROM sf_sla.sla_policy WHERE tenant_id = $1 AND policy_id = $2`,
      [this.tenantId, id],
    );
    return r.rows[0] ? toPolicy(r.rows[0]) : null;
  }

  async latestPolicyVersion(code: string): Promise<number> {
    const r = await this.c.query<{ v: string | number | null }>(
      `SELECT max(version_no) AS v FROM sf_sla.sla_policy WHERE tenant_id = $1 AND policy_code = $2`,
      [this.tenantId, code],
    );
    return numOrNull(r.rows[0]?.v) ?? 0;
  }

  async retirePolicy(id: string, now: Date): Promise<void> {
    await this.c.query(
      `UPDATE sf_sla.sla_policy SET status = 'RETIRED', retired_at = $3 WHERE tenant_id = $1 AND policy_id = $2`,
      [this.tenantId, id, now.toISOString()],
    );
  }

  async insertClock(row: ClockRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_sla.sla_clock (
         tenant_id, clock_id, cell_id, application_id, stage_code, policy_id, calendar_id, start_anchor,
         completion_anchor, anchor_event_ref, status, started_at, deadline_at, escalation_level,
         aggregate_version, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        this.tenantId,
        row.clock_id,
        row.cell_id,
        row.application_id,
        row.stage_code,
        row.policy_id,
        row.calendar_id,
        row.start_anchor,
        row.completion_anchor,
        row.anchor_event_ref,
        row.status,
        row.started_at,
        row.deadline_at,
        row.escalation_level,
        row.aggregate_version,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  async getClock(id: string): Promise<ClockRow | null> {
    const r = await this.c.query(SELECT_CLOCK_BY_ID, [this.tenantId, id]);
    return r.rows[0] ? toClock(r.rows[0]) : null;
  }

  async lockClock(id: string): Promise<ClockRow | null> {
    const r = await this.c.query(LOCK_CLOCK_BY_ID, [this.tenantId, id]);
    return r.rows[0] ? toClock(r.rows[0]) : null;
  }

  async findClock(applicationId: string, stageCode: string): Promise<ClockRow | null> {
    const r = await this.c.query(SELECT_CLOCK_BY_STAGE, [this.tenantId, applicationId, stageCode]);
    return r.rows[0] ? toClock(r.rows[0]) : null;
  }

  async clocksForApplication(applicationId: string): Promise<ClockRow[]> {
    const r = await this.c.query(SELECT_CLOCKS_BY_APPLICATION, [this.tenantId, applicationId]);
    return r.rows.map(toClock);
  }

  async updateClock(
    id: string,
    state: ClockState,
    expectedVersion: number,
    now: Date,
  ): Promise<void> {
    const r = await this.c.query(
      `UPDATE sf_sla.sla_clock SET
         status = $4, deadline_at = $5, remaining_ms = $6, paused_at = $7, pause_reason_code = $8,
         pause_count = $9, resumed_at = $10, completed_at = $11, breach_at = $12,
         warning_emitted_at = $13, escalation_level = $14, aggregate_version = aggregate_version + 1,
         updated_at = $15
       WHERE tenant_id = $1 AND clock_id = $2 AND aggregate_version = $3`,
      [
        this.tenantId,
        id,
        expectedVersion,
        state.status,
        state.deadline_at,
        state.remaining_ms,
        state.paused_at,
        state.pause_reason_code,
        state.pause_count,
        state.resumed_at,
        state.completed_at,
        state.breach_at,
        state.warning_emitted_at,
        state.escalation_level,
        now.toISOString(),
      ],
    );
    if ((r.rowCount ?? 0) !== 1)
      throw new Cmp029Error('SF-APP-002', { details: [{ code: 'CONCURRENT_UPDATE' }] });
  }

  async appendHistory(row: HistoryRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_sla.sla_clock_event (
         tenant_id, clock_id, sequence_no, operation, from_status, to_status, occurred_at, reason_code,
         deadline_before, deadline_after, remaining_ms, escalation_level, actor_type, actor_id, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        this.tenantId,
        row.clock_id,
        row.sequence_no,
        row.operation,
        row.from_status,
        row.to_status,
        row.occurred_at,
        row.reason_code,
        row.deadline_before,
        row.deadline_after,
        row.remaining_ms,
        row.escalation_level,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
      ],
    );
  }

  async listHistory(clockId: string): Promise<HistoryRow[]> {
    const r = await this.c.query(
      `SELECT clock_id, sequence_no, operation, from_status, to_status, occurred_at, reason_code,
              deadline_before, deadline_after, remaining_ms, escalation_level, actor_type, actor_id,
              correlation_id
         FROM sf_sla.sla_clock_event WHERE tenant_id = $1 AND clock_id = $2 ORDER BY sequence_no`,
      [this.tenantId, clockId],
    );
    return r.rows.map(toHistory);
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_sla.outbox_event (
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

export class PgSlaRepository implements SlaRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: SlaTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp029Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp029Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
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
        // connection already failed; the original error is the one to surface
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
