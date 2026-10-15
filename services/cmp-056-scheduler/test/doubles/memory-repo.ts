import { canBook } from '../../src/domain/appointment.js';
import type {
  AppointmentEventLogRow,
  AppointmentRecord,
  AppointmentTypeRecord,
  SlotRecord,
} from '../../src/domain/appointment.js';
import { Cmp056Error } from '../../src/errors.js';
import type {
  SchedulerRepository,
  SchedulerTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  types: Map<string, AppointmentTypeRecord>;
  typesByRef: Map<string, string>;
  slots: Map<string, SlotRecord>;
  slotsByRef: Map<string, string>;
  appointments: Map<string, AppointmentRecord>;
  events: AppointmentEventLogRow[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return {
    types: new Map(),
    typesByRef: new Map(),
    slots: new Map(),
    slotsByRef: new Map(),
    appointments: new Map(),
    events: [],
    idempotency: new Map(),
    outbox: [],
  };
}

/**
 * In-memory tenant-partitioned repository mirroring atomic capacity and contract constants
 * so unit tests cannot pass on behaviour the database would refuse.
 */
export class MemorySchedulerRepository implements SchedulerRepository {
  private readonly stores = new Map<string, TenantStore>();
  private depth = 0;
  failNextCommit = false;
  txCount = 0;

  tenant(tenantId: string): TenantStore {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = emptyStore();
      this.stores.set(tenantId, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.depth > 0;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp056Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    const store = this.tenant(ctx.tenant_id);
    const backup: TenantStore = {
      types: new Map(store.types),
      typesByRef: new Map(store.typesByRef),
      slots: new Map(store.slots),
      slotsByRef: new Map(store.slotsByRef),
      appointments: new Map(store.appointments),
      events: store.events.map((e) => structuredClone(e)),
      idempotency: new Map(store.idempotency),
      outbox: store.outbox.map((o) => structuredClone(o)),
    };
    this.depth += 1;
    this.txCount += 1;
    try {
      const result = await fn(new MemoryTx(store));
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('commit failed');
      }
      return result;
    } catch (err) {
      store.types = backup.types;
      store.typesByRef = backup.typesByRef;
      store.slots = backup.slots;
      store.slotsByRef = backup.slotsByRef;
      store.appointments = backup.appointments;
      store.events = backup.events;
      store.idempotency = backup.idempotency;
      store.outbox = backup.outbox;
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

class MemoryTx implements SchedulerTx {
  constructor(private readonly s: TenantStore) {}

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const id = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.s.idempotency.get(id);
    if (!existing) {
      this.s.idempotency.set(id, { fingerprint: p.fingerprint, status: 'IN_PROGRESS' });
      return Promise.resolve('claimed');
    }
    if (existing.fingerprint !== p.fingerprint) throw new Cmp056Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp056Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.s.idempotency.get(`${p.principalId}|${p.endpoint}|${p.key}`);
    if (row) {
      row.status = 'COMPLETED';
      row.response = structuredClone({ status: p.status, body: p.body });
    }
    return Promise.resolve();
  }

  insertType(row: AppointmentTypeRecord): Promise<void> {
    if (this.s.types.has(row.appointment_type_id) || this.s.typesByRef.has(row.appointment_type_ref)) {
      throw new Cmp056Error('SF-APP-002');
    }
    this.s.types.set(row.appointment_type_id, structuredClone(row));
    this.s.typesByRef.set(row.appointment_type_ref, row.appointment_type_id);
    return Promise.resolve();
  }

  getType(typeId: string): Promise<AppointmentTypeRecord | undefined> {
    const row = this.s.types.get(typeId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  getTypeByRef(typeRef: string): Promise<AppointmentTypeRecord | undefined> {
    const id = this.s.typesByRef.get(typeRef);
    return id ? this.getType(id) : Promise.resolve(undefined);
  }

  insertSlot(row: SlotRecord): Promise<void> {
    if (this.s.slots.has(row.slot_id) || this.s.slotsByRef.has(row.slot_ref)) {
      throw new Cmp056Error('SF-APP-002');
    }
    if (row.booked_count > row.capacity) throw new Cmp056Error('SF-APP-001', { details: [{ code: 'SLOT_FULL' }] });
    this.s.slots.set(row.slot_id, structuredClone(row));
    this.s.slotsByRef.set(row.slot_ref, row.slot_id);
    return Promise.resolve();
  }

  getSlot(slotId: string): Promise<SlotRecord | undefined> {
    const row = this.s.slots.get(slotId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  getSlotByRef(slotRef: string): Promise<SlotRecord | undefined> {
    const id = this.s.slotsByRef.get(slotRef);
    return id ? this.getSlot(id) : Promise.resolve(undefined);
  }

  listAvailableSlots(appointmentTypeId: string | undefined): Promise<SlotRecord[]> {
    const rows = [...this.s.slots.values()].filter(
      (s) => canBook(s) && (appointmentTypeId === undefined || s.appointment_type_id === appointmentTypeId),
    );
    rows.sort((a, b) => a.opens_at.localeCompare(b.opens_at));
    return Promise.resolve(structuredClone(rows));
  }

  updateSlotBooked(row: SlotRecord): Promise<void> {
    const old = this.s.slots.get(row.slot_id);
    if (!old) throw new Cmp056Error('SF-APP-001');
    if (row.booked_count > old.capacity || row.booked_count < 0) {
      throw new Cmp056Error('SF-APP-001', { details: [{ code: 'SLOT_FULL' }] });
    }
    this.s.slots.set(row.slot_id, {
      ...old,
      booked_count: row.booked_count,
      updated_at: row.updated_at,
      last_correlation_id: row.last_correlation_id,
    });
    return Promise.resolve();
  }

  insertAppointment(row: AppointmentRecord): Promise<void> {
    if (this.s.appointments.has(row.appointment_id)) throw new Cmp056Error('SF-APP-002');
    if (row.lifecycle_status !== 'BOOKED' || row.appointment_version !== 1) {
      throw new Cmp056Error('SF-APP-001');
    }
    this.s.appointments.set(row.appointment_id, structuredClone(row));
    return Promise.resolve();
  }

  getAppointment(appointmentId: string): Promise<AppointmentRecord | undefined> {
    const row = this.s.appointments.get(appointmentId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  updateAppointment(row: AppointmentRecord): Promise<void> {
    const old = this.s.appointments.get(row.appointment_id);
    if (!old || row.appointment_version !== old.appointment_version + 1) {
      throw new Cmp056Error('SF-APP-001');
    }
    this.s.appointments.set(row.appointment_id, structuredClone(row));
    return Promise.resolve();
  }

  insertEventLog(row: AppointmentEventLogRow): Promise<void> {
    if (
      this.s.events.some(
        (e) => e.appointment_id === row.appointment_id && e.appointment_version === row.appointment_version,
      )
    ) {
      throw new Cmp056Error('SF-APP-002');
    }
    this.s.events.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
