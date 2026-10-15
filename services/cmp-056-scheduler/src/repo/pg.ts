import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  AppointmentEventLogRow,
  AppointmentRecord,
  AppointmentTypeRecord,
  LifecycleStatus,
  NotificationStatus,
  SlotRecord,
} from '../domain/appointment.js';
import { IDEMPOTENCY_TTL_MS } from '../domain/fingerprint.js';
import { Cmp056Error } from '../errors.js';
import { TOPIC_AUDIT } from '../outbox.js';
import type { EventEnvelope, RequestContext } from '../types.js';
import type { SchedulerRepository, SchedulerTx, StoredIdempotent } from './types.js';

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

function toType(r: Record<string, unknown>): AppointmentTypeRecord {
  return {
    tenant_id: String(r['tenant_id']),
    appointment_type_id: String(r['appointment_type_id']),
    appointment_type_ref: String(r['appointment_type_ref']),
    resource_calendar_ref: strOrNull(r['resource_calendar_ref']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    created_by: String(r['created_by']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toSlot(r: Record<string, unknown>): SlotRecord {
  return {
    tenant_id: String(r['tenant_id']),
    slot_id: String(r['slot_id']),
    slot_ref: String(r['slot_ref']),
    appointment_type_id: String(r['appointment_type_id']),
    capacity: Number(r['capacity']),
    booked_count: Number(r['booked_count']),
    opens_at: iso(r['opens_at']),
    closes_at: iso(r['closes_at']),
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    last_correlation_id: String(r['last_correlation_id']),
  };
}

function toAppt(r: Record<string, unknown>): AppointmentRecord {
  return {
    tenant_id: String(r['tenant_id']),
    appointment_id: String(r['appointment_id']),
    appointment_type_id: String(r['appointment_type_id']),
    appointment_type_ref: String(r['appointment_type_ref']),
    slot_id: String(r['slot_id']),
    slot_ref: String(r['slot_ref']),
    resource_calendar_ref: strOrNull(r['resource_calendar_ref']),
    lifecycle_status: r['lifecycle_status'] as LifecycleStatus,
    appointment_version: Number(r['appointment_version']),
    participant_ref: strOrNull(r['participant_ref']),
    notification_status: r['notification_status'] as NotificationStatus,
    created_at: iso(r['created_at']),
    updated_at: iso(r['updated_at']),
    created_by: String(r['created_by']),
    last_correlation_id: String(r['last_correlation_id']),
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
    const existing = await this.c.query<{
      request_fingerprint: string;
      status: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT request_fingerprint, status, response_status, response_body
         FROM sf_scheduler.idempotency_record
        WHERE tenant_id = $1 AND principal_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
      [this.tenantId, p.principalId, p.endpoint, p.key],
    );
    const row = existing.rows[0];
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

  async insertType(row: AppointmentTypeRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.appointment_type (
         tenant_id, appointment_type_id, appointment_type_ref, resource_calendar_ref,
         created_at, updated_at, created_by, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.tenant_id,
        row.appointment_type_id,
        row.appointment_type_ref,
        row.resource_calendar_ref,
        row.created_at,
        row.updated_at,
        row.created_by,
        row.last_correlation_id,
      ],
    );
  }

  async getType(typeId: string): Promise<AppointmentTypeRecord | undefined> {
    const res = await this.c.query(
      `SELECT * FROM sf_scheduler.appointment_type WHERE tenant_id = $1 AND appointment_type_id = $2`,
      [this.tenantId, typeId],
    );
    return res.rows[0] ? toType(res.rows[0]) : undefined;
  }

  async getTypeByRef(typeRef: string): Promise<AppointmentTypeRecord | undefined> {
    const res = await this.c.query(
      `SELECT * FROM sf_scheduler.appointment_type WHERE tenant_id = $1 AND appointment_type_ref = $2`,
      [this.tenantId, typeRef],
    );
    return res.rows[0] ? toType(res.rows[0]) : undefined;
  }

  async insertSlot(row: SlotRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.slot (
         tenant_id, slot_id, slot_ref, appointment_type_id, capacity, booked_count,
         opens_at, closes_at, created_at, updated_at, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.tenant_id,
        row.slot_id,
        row.slot_ref,
        row.appointment_type_id,
        row.capacity,
        row.booked_count,
        row.opens_at,
        row.closes_at,
        row.created_at,
        row.updated_at,
        row.last_correlation_id,
      ],
    );
  }

  async getSlot(slotId: string, forUpdate = false): Promise<SlotRecord | undefined> {
    const sql = forUpdate
      ? 'SELECT * FROM sf_scheduler.slot WHERE tenant_id = $1 AND slot_id = $2 FOR UPDATE'
      : 'SELECT * FROM sf_scheduler.slot WHERE tenant_id = $1 AND slot_id = $2';
    const res = await this.c.query(sql, [this.tenantId, slotId]);
    return res.rows[0] ? toSlot(res.rows[0]) : undefined;
  }

  async getSlotByRef(slotRef: string, forUpdate = false): Promise<SlotRecord | undefined> {
    const sql = forUpdate
      ? 'SELECT * FROM sf_scheduler.slot WHERE tenant_id = $1 AND slot_ref = $2 FOR UPDATE'
      : 'SELECT * FROM sf_scheduler.slot WHERE tenant_id = $1 AND slot_ref = $2';
    const res = await this.c.query(sql, [this.tenantId, slotRef]);
    return res.rows[0] ? toSlot(res.rows[0]) : undefined;
  }

  async listAvailableSlots(appointmentTypeId: string | undefined): Promise<SlotRecord[]> {
    const res = appointmentTypeId
      ? await this.c.query(
          `SELECT * FROM sf_scheduler.slot
            WHERE tenant_id = $1 AND appointment_type_id = $2 AND booked_count < capacity
            ORDER BY opens_at`,
          [this.tenantId, appointmentTypeId],
        )
      : await this.c.query(
          `SELECT * FROM sf_scheduler.slot
            WHERE tenant_id = $1 AND booked_count < capacity
            ORDER BY opens_at`,
          [this.tenantId],
        );
    return res.rows.map(toSlot);
  }

  async updateSlotBooked(row: SlotRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_scheduler.slot
          SET booked_count = $3, updated_at = $4, last_correlation_id = $5
        WHERE tenant_id = $1 AND slot_id = $2`,
      [this.tenantId, row.slot_id, row.booked_count, row.updated_at, row.last_correlation_id],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp056Error('SF-APP-001');
  }

  async insertAppointment(row: AppointmentRecord): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.appointment (
         tenant_id, appointment_id, appointment_type_id, appointment_type_ref, slot_id, slot_ref,
         resource_calendar_ref, lifecycle_status, appointment_version, participant_ref,
         notification_status, created_at, updated_at, created_by, last_correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.tenant_id,
        row.appointment_id,
        row.appointment_type_id,
        row.appointment_type_ref,
        row.slot_id,
        row.slot_ref,
        row.resource_calendar_ref,
        row.lifecycle_status,
        row.appointment_version,
        row.participant_ref,
        row.notification_status,
        row.created_at,
        row.updated_at,
        row.created_by,
        row.last_correlation_id,
      ],
    );
  }

  async getAppointment(
    appointmentId: string,
    forUpdate = false,
  ): Promise<AppointmentRecord | undefined> {
    const sql = forUpdate
      ? 'SELECT * FROM sf_scheduler.appointment WHERE tenant_id = $1 AND appointment_id = $2 FOR UPDATE'
      : 'SELECT * FROM sf_scheduler.appointment WHERE tenant_id = $1 AND appointment_id = $2';
    const res = await this.c.query(sql, [this.tenantId, appointmentId]);
    return res.rows[0] ? toAppt(res.rows[0]) : undefined;
  }

  async updateAppointment(row: AppointmentRecord): Promise<void> {
    const res = await this.c.query(
      `UPDATE sf_scheduler.appointment
          SET slot_id = $3, slot_ref = $4, lifecycle_status = $5, appointment_version = $6,
              notification_status = $7, updated_at = $8, last_correlation_id = $9,
              resource_calendar_ref = $10
        WHERE tenant_id = $1 AND appointment_id = $2 AND appointment_version = $6 - 1`,
      [
        this.tenantId,
        row.appointment_id,
        row.slot_id,
        row.slot_ref,
        row.lifecycle_status,
        row.appointment_version,
        row.notification_status,
        row.updated_at,
        row.last_correlation_id,
        row.resource_calendar_ref,
      ],
    );
    if ((res.rowCount ?? 0) !== 1) throw new Cmp056Error('SF-APP-001');
  }

  async insertEventLog(row: AppointmentEventLogRow): Promise<void> {
    await this.c.query(
      `INSERT INTO sf_scheduler.appointment_event_log (
         tenant_id, event_log_id, appointment_id, from_status, to_status, from_slot_ref,
         to_slot_ref, appointment_version, actor_id, correlation_id, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.tenant_id,
        row.event_log_id,
        row.appointment_id,
        row.from_status,
        row.to_status,
        row.from_slot_ref,
        row.to_slot_ref,
        row.appointment_version,
        row.actor_id,
        row.correlation_id,
        row.occurred_at,
      ],
    );
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
