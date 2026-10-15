import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppointmentHistoryRow, AppointmentRow } from '../domain/appointment.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import type { NotificationOutcomeRow } from '../domain/notification.js';
import type { SlotRow } from '../domain/slot.js';
import { Cmp056Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type {
  AppointmentPatch,
  IdempotencyPeek,
  SchedulerRepository,
  SchedulerTx,
  SlotFilter,
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

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const SLOT_COLS = `tenant_id, slot_id, slot_ref, appointment_type_ref, resource_calendar_ref,
  jurisdiction_id, starts_at, ends_at, capacity, booked_count, status, actor_type, created_by,
  correlation_id, created_at, updated_at`;
const SELECT_SLOT = `SELECT ${SLOT_COLS} FROM sf_scheduler.slot`;

const APPOINTMENT_COLS = `tenant_id, appointment_id, appointment_type_ref, slot_id, slot_ref,
  resource_calendar_ref, application_id, lifecycle_status, idempotency_key, version,
  correlation_id, actor_type, booked_by, booked_at, updated_at`;
const SELECT_APPOINTMENT = `SELECT ${APPOINTMENT_COLS} FROM sf_scheduler.appointment`;

function toSlot(r: Record<string, unknown>): SlotRow {
  return {
    tenant_id: String(r['tenant_id']),
    slot_id: String(r['slot_id']),
    slot_ref: String(r['slot_ref']),
    appointment_type_ref: String(r['appointment_type_ref']),
    resource_calendar_ref: strOrNull(r['resource_calendar_ref']),
    jurisdiction_id: strOrNull(r['jurisdiction_id']),
    starts_at: iso(r['starts_at']),
    ends_at: iso(r['ends_at']),
    capacity: Number(r['capacity']),
    booked_count: Number(r['booked_count']),
    status: r['status'] as SlotRow['status'],
    actor_type: r['actor_type'] as SlotRow['actor_type'],
    created_by: String(r['created_by']),
    correlation_id: String(r['correlation_id']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
  };
}

function toAppointment(r: Record<string, unknown>): AppointmentRow {
  return {
    tenant_id: String(r['tenant_id']),
    appointment_id: String(r['appointment_id']),
    appointment_type_ref: String(r['appointment_type_ref']),
    slot_id: String(r['slot_id']),
    slot_ref: String(r['slot_ref']),
    resource_calendar_ref: strOrNull(r['resource_calendar_ref']),
    application_id: strOrNull(r['application_id']),
    lifecycle_status: r['lifecycle_status'] as AppointmentRow['lifecycle_status'],
    idempotency_key: String(r['idempotency_key']),
    version: Number(r['version']),
    correlation_id: String(r['correlation_id']),
    actor_type: r['actor_type'] as AppointmentRow['actor_type'],
    booked_by: String(r['booked_by']),
    booked_at: iso(r['booked_at']),
    updated_at: iso(r['updated_at']),
  };
}

function toOutcome(r: Record<string, unknown>): NotificationOutcomeRow {
  return {
    tenant_id: String(r['tenant_id']),
    outcome_id: String(r['outcome_id']),
    appointment_id: String(r['appointment_id']),
    outcome: r['outcome'] as NotificationOutcomeRow['outcome'],
    outcome_ref: String(r['outcome_ref']),
    failure_code: strOrNull(r['failure_code']),
    actor_type: r['actor_type'] as NotificationOutcomeRow['actor_type'],
    recorded_by: String(r['recorded_by']),
    correlation_id: String(r['correlation_id']),
    recorded_at: iso(r['recorded_at']),
  };
}

class PgTx implements SchedulerTx {
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
      `INSERT INTO sf_scheduler.idempotency_record (
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
    const r = await this.c.query<IdempotencyPeek>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_scheduler.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = r.rows[0];
    if (!row) throw new Cmp056Error('SF-SYS-001');
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp056Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body };
    }
    throw new Cmp056Error('SF-APP-002');
  }

  async completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    await this.c.query(
      `UPDATE sf_scheduler.idempotency_record
          SET status = 'COMPLETED', response_status = $5, response_body = $6::jsonb
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key, p.status, JSON.stringify(p.body)],
    );
  }

  async insertSlot(row: SlotRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_scheduler.slot (
         tenant_id, slot_id, slot_ref, appointment_type_ref, resource_calendar_ref, jurisdiction_id,
         starts_at, ends_at, capacity, booked_count, status, actor_type, created_by, correlation_id,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'OPEN',$10,$11,$12,$13,$13)
       ON CONFLICT (tenant_id, slot_ref) DO NOTHING`,
      [
        row.tenant_id,
        row.slot_id,
        row.slot_ref,
        row.appointment_type_ref,
        row.resource_calendar_ref,
        row.jurisdiction_id,
        row.starts_at,
        row.ends_at,
        row.capacity,
        row.actor_type,
        row.created_by,
        row.correlation_id,
        row.created_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async getSlotByRef(slotRef: string): Promise<SlotRow | undefined> {
    const r = await this.c.query(SELECT_SLOT + ' WHERE tenant_id = $1 AND slot_ref = $2', [
      this.tenantId,
      slotRef,
    ]);
    return r.rows[0] ? toSlot(r.rows[0]) : undefined;
  }

  async getSlotById(slotId: string): Promise<SlotRow | undefined> {
    const r = await this.c.query(SELECT_SLOT + ' WHERE tenant_id = $1 AND slot_id = $2', [
      this.tenantId,
      slotId,
    ]);
    return r.rows[0] ? toSlot(r.rows[0]) : undefined;
  }

  async listBookableSlots(f: SlotFilter): Promise<SlotRow[]> {
    const r = await this.c.query(
      SELECT_SLOT +
        ` WHERE tenant_id = $1 AND status = 'OPEN' AND booked_count < capacity
            AND starts_at > $2
            AND ($3::timestamptz IS NULL OR starts_at < $3)
            AND ($4::text IS NULL OR appointment_type_ref = $4)
            AND ($5::text IS NULL OR resource_calendar_ref = $5)
          ORDER BY starts_at, slot_ref LIMIT $6`,
      [
        this.tenantId,
        f.starts_after,
        f.starts_before,
        f.appointment_type_ref,
        f.resource_calendar_ref,
        f.limit,
      ],
    );
    return r.rows.map(toSlot);
  }

  async lockSlots(slotIds: string[]): Promise<SlotRow[]> {
    const r = await this.c.query(
      SELECT_SLOT +
        ' WHERE tenant_id = $1 AND slot_id = ANY($2::uuid[]) ORDER BY slot_id FOR UPDATE',
      [this.tenantId, slotIds],
    );
    return r.rows.map(toSlot);
  }

  async reserveSeat(slotId: string, now: string): Promise<SlotRow | undefined> {
    const r = await this.c.query(
      `UPDATE sf_scheduler.slot
          SET booked_count = booked_count + 1, updated_at = $3
        WHERE tenant_id = $1 AND slot_id = $2 AND status = 'OPEN'
          AND starts_at > $3 AND booked_count < capacity
        RETURNING tenant_id, slot_id, slot_ref, appointment_type_ref, resource_calendar_ref,
          jurisdiction_id, starts_at, ends_at, capacity, booked_count, status, actor_type,
          created_by, correlation_id, created_at, updated_at`,
      [this.tenantId, slotId, now],
    );
    return r.rows[0] ? toSlot(r.rows[0]) : undefined;
  }

  async releaseSeat(slotId: string, now: string): Promise<boolean> {
    const r = await this.c.query(
      `UPDATE sf_scheduler.slot
          SET booked_count = booked_count - 1, updated_at = $3
        WHERE tenant_id = $1 AND slot_id = $2 AND booked_count > 0`,
      [this.tenantId, slotId, now],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertAppointment(row: AppointmentRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.appointment (
         tenant_id, appointment_id, appointment_type_ref, slot_id, slot_ref, resource_calendar_ref,
         application_id, lifecycle_status, idempotency_key, version, correlation_id, actor_type,
         booked_by, booked_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.tenant_id,
        row.appointment_id,
        row.appointment_type_ref,
        row.slot_id,
        row.slot_ref,
        row.resource_calendar_ref,
        row.application_id,
        row.lifecycle_status,
        row.idempotency_key,
        row.version,
        row.correlation_id,
        row.actor_type,
        row.booked_by,
        row.booked_at,
        row.updated_at,
      ],
    );
  }

  async getAppointment(appointmentId: string): Promise<AppointmentRow | undefined> {
    const r = await this.c.query(
      SELECT_APPOINTMENT + ' WHERE tenant_id = $1 AND appointment_id = $2',
      [this.tenantId, appointmentId],
    );
    return r.rows[0] ? toAppointment(r.rows[0]) : undefined;
  }

  async lockAppointment(appointmentId: string): Promise<AppointmentRow | undefined> {
    const r = await this.c.query(
      SELECT_APPOINTMENT + ' WHERE tenant_id = $1 AND appointment_id = $2 FOR UPDATE',
      [this.tenantId, appointmentId],
    );
    return r.rows[0] ? toAppointment(r.rows[0]) : undefined;
  }

  async updateAppointment(
    appointmentId: string,
    expectedVersion: number,
    patch: AppointmentPatch,
  ): Promise<boolean> {
    const r = await this.c.query(
      `UPDATE sf_scheduler.appointment
          SET lifecycle_status = $4, slot_id = $5, slot_ref = $6, resource_calendar_ref = $7,
              version = $8, updated_at = $9
        WHERE tenant_id = $1 AND appointment_id = $2 AND version = $3`,
      [
        this.tenantId,
        appointmentId,
        expectedVersion,
        patch.lifecycle_status,
        patch.slot_id,
        patch.slot_ref,
        patch.resource_calendar_ref,
        patch.version,
        patch.updated_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async insertHistory(row: AppointmentHistoryRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.appointment_event (
         tenant_id, appointment_event_id, appointment_id, version, from_status, to_status, slot_ref,
         previous_slot_ref, actor_type, actor_id, correlation_id, recorded_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.tenant_id,
        row.appointment_event_id,
        row.appointment_id,
        row.version,
        row.from_status,
        row.to_status,
        row.slot_ref,
        row.previous_slot_ref,
        row.actor_type,
        row.actor_id,
        row.correlation_id,
        row.recorded_at,
      ],
    );
  }

  async insertNotificationOutcome(row: NotificationOutcomeRow): Promise<boolean> {
    const r = await this.c.query(
      `INSERT INTO sf_scheduler.notification_outcome (
         tenant_id, outcome_id, appointment_id, outcome, outcome_ref, failure_code, actor_type,
         recorded_by, correlation_id, recorded_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, appointment_id, outcome_ref) DO NOTHING`,
      [
        row.tenant_id,
        row.outcome_id,
        row.appointment_id,
        row.outcome,
        row.outcome_ref,
        row.failure_code,
        row.actor_type,
        row.recorded_by,
        row.correlation_id,
        row.recorded_at,
      ],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async findNotificationOutcome(
    appointmentId: string,
    outcomeRef: string,
  ): Promise<NotificationOutcomeRow | undefined> {
    const r = await this.c.query(
      `SELECT tenant_id, outcome_id, appointment_id, outcome, outcome_ref, failure_code,
              actor_type, recorded_by, correlation_id, recorded_at
         FROM sf_scheduler.notification_outcome
        WHERE tenant_id = $1 AND appointment_id = $2 AND outcome_ref = $3`,
      [this.tenantId, appointmentId, outcomeRef],
    );
    return r.rows[0] ? toOutcome(r.rows[0]) : undefined;
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.outbox_event (
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

export class PgSchedulerRepository implements SchedulerRepository {
  private readonly als = new AsyncLocalStorage<true>();

  constructor(private readonly pool: SqlPool) {}

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp056Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
