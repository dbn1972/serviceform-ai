import { AsyncLocalStorage } from 'node:async_hooks';
import {
  canTransition,
  type AppointmentHistoryRow,
  type AppointmentRow,
} from '../../src/domain/appointment.js';
import type { NotificationOutcomeRow } from '../../src/domain/notification.js';
import type { SlotRow } from '../../src/domain/slot.js';
import { Cmp056Error } from '../../src/errors.js';
import type {
  AppointmentPatch,
  IdempotencyPeek,
  SchedulerRepository,
  SchedulerTx,
  SlotFilter,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantState {
  slots: Map<string, SlotRow>;
  appointments: Map<string, AppointmentRow>;
  history: AppointmentHistoryRow[];
  outcomes: NotificationOutcomeRow[];
  idempotency: Map<string, IdempotencyPeek>;
  outbox: { topic: string; envelope: EventEnvelope<Record<string, unknown>> }[];
}

function emptyTenant(): TenantState {
  return {
    slots: new Map(),
    appointments: new Map(),
    history: [],
    outcomes: [],
    idempotency: new Map(),
    outbox: [],
  };
}

function cloneTenant(s: TenantState): TenantState {
  return {
    slots: new Map([...s.slots].map(([k, v]) => [k, { ...v }])),
    appointments: new Map([...s.appointments].map(([k, v]) => [k, { ...v }])),
    history: s.history.map((h) => ({ ...h })),
    outcomes: s.outcomes.map((o) => ({ ...o })),
    idempotency: new Map([...s.idempotency].map(([k, v]) => [k, { ...v }])),
    outbox: [...s.outbox],
  };
}

const pgError = (code: string): Error => Object.assign(new Error(code), { code });
const idemKey = (p: { principalId: string; endpoint: string; key: string }): string =>
  `${p.principalId}|${p.endpoint}|${p.key}`;

/** Mirrors the sf_scheduler CHECKs and triggers (55000 transitions, 42501 immutability). */
class MemoryTx implements SchedulerTx {
  constructor(private readonly s: TenantState) {}

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = idemKey(p);
    const row = this.s.idempotency.get(k);
    if (!row) {
      this.s.idempotency.set(k, {
        request_fingerprint: p.fingerprint,
        status: 'IN_PROGRESS',
        response_status: null,
        response_body: null,
      });
      return Promise.resolve('claimed');
    }
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp056Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return Promise.resolve({ status: row.response_status, body: row.response_body });
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
    const row = this.s.idempotency.get(idemKey(p));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = p.status;
      row.response_body = JSON.parse(JSON.stringify(p.body)) as unknown;
    }
    return Promise.resolve();
  }

  insertSlot(row: SlotRow): Promise<boolean> {
    if (row.booked_count !== 0 || row.status !== 'OPEN') throw pgError('55000');
    for (const s of this.s.slots.values()) {
      if (s.slot_ref === row.slot_ref) return Promise.resolve(false);
    }
    this.s.slots.set(row.slot_id, { ...row });
    return Promise.resolve(true);
  }

  getSlotByRef(slotRef: string): Promise<SlotRow | undefined> {
    const s = [...this.s.slots.values()].find((x) => x.slot_ref === slotRef);
    return Promise.resolve(s ? { ...s } : undefined);
  }

  getSlotById(slotId: string): Promise<SlotRow | undefined> {
    const s = this.s.slots.get(slotId);
    return Promise.resolve(s ? { ...s } : undefined);
  }

  listBookableSlots(f: SlotFilter): Promise<SlotRow[]> {
    const after = Date.parse(f.starts_after);
    const before = f.starts_before === null ? Infinity : Date.parse(f.starts_before);
    return Promise.resolve(
      [...this.s.slots.values()]
        .filter(
          (s) =>
            s.status === 'OPEN' &&
            s.booked_count < s.capacity &&
            Date.parse(s.starts_at) > after &&
            Date.parse(s.starts_at) < before &&
            (f.appointment_type_ref === null ||
              s.appointment_type_ref === f.appointment_type_ref) &&
            (f.resource_calendar_ref === null ||
              s.resource_calendar_ref === f.resource_calendar_ref),
        )
        .sort(
          (a, b) => a.starts_at.localeCompare(b.starts_at) || a.slot_ref.localeCompare(b.slot_ref),
        )
        .slice(0, f.limit)
        .map((s) => ({ ...s })),
    );
  }

  lockSlots(slotIds: string[]): Promise<SlotRow[]> {
    return Promise.resolve(
      [...slotIds]
        .sort()
        .map((id) => this.s.slots.get(id))
        .filter((s): s is SlotRow => s !== undefined)
        .map((s) => ({ ...s })),
    );
  }

  reserveSeat(slotId: string, now: string): Promise<SlotRow | undefined> {
    const s = this.s.slots.get(slotId);
    if (
      !s ||
      s.status !== 'OPEN' ||
      Date.parse(s.starts_at) <= Date.parse(now) ||
      s.booked_count >= s.capacity
    ) {
      return Promise.resolve(undefined);
    }
    s.booked_count += 1;
    s.updated_at = now;
    return Promise.resolve({ ...s });
  }

  releaseSeat(slotId: string, now: string): Promise<boolean> {
    const s = this.s.slots.get(slotId);
    if (!s || s.booked_count === 0) return Promise.resolve(false);
    s.booked_count -= 1;
    s.updated_at = now;
    return Promise.resolve(true);
  }

  private assertMatchesSlot(
    row: Pick<
      AppointmentRow,
      'slot_id' | 'slot_ref' | 'appointment_type_ref' | 'resource_calendar_ref'
    >,
  ): void {
    const s = this.s.slots.get(row.slot_id);
    if (
      !s ||
      s.slot_ref !== row.slot_ref ||
      s.appointment_type_ref !== row.appointment_type_ref ||
      s.resource_calendar_ref !== row.resource_calendar_ref
    ) {
      throw pgError('55000');
    }
  }

  insertAppointment(row: AppointmentRow): Promise<void> {
    if (row.lifecycle_status !== 'BOOKED' || row.version !== 1) throw pgError('55000');
    if (this.s.appointments.has(row.appointment_id)) throw pgError('23505');
    this.assertMatchesSlot(row);
    this.s.appointments.set(row.appointment_id, { ...row });
    return Promise.resolve();
  }

  getAppointment(appointmentId: string): Promise<AppointmentRow | undefined> {
    const a = this.s.appointments.get(appointmentId);
    return Promise.resolve(a ? { ...a } : undefined);
  }

  lockAppointment(appointmentId: string): Promise<AppointmentRow | undefined> {
    return this.getAppointment(appointmentId);
  }

  updateAppointment(
    appointmentId: string,
    expectedVersion: number,
    patch: AppointmentPatch,
  ): Promise<boolean> {
    const a = this.s.appointments.get(appointmentId);
    if (!a || a.version !== expectedVersion) return Promise.resolve(false);
    if (!canTransition(a.lifecycle_status, patch.lifecycle_status)) throw pgError('55000');
    if (patch.version !== a.version + 1) throw pgError('55000');
    const slotChanged = patch.slot_id !== a.slot_id;
    if ((patch.lifecycle_status === 'RESCHEDULED') !== slotChanged) throw pgError('55000');
    this.assertMatchesSlot({ ...patch, appointment_type_ref: a.appointment_type_ref });
    Object.assign(a, patch);
    return Promise.resolve(true);
  }

  insertHistory(row: AppointmentHistoryRow): Promise<void> {
    const a = this.s.appointments.get(row.appointment_id);
    if (!a) throw pgError('23503');
    if (a.version !== row.version || a.lifecycle_status !== row.to_status) throw pgError('55000');
    this.s.history.push({ ...row });
    return Promise.resolve();
  }

  insertNotificationOutcome(row: NotificationOutcomeRow): Promise<boolean> {
    if (!this.s.appointments.has(row.appointment_id)) throw pgError('23503');
    if (
      this.s.outcomes.some(
        (o) => o.appointment_id === row.appointment_id && o.outcome_ref === row.outcome_ref,
      )
    ) {
      return Promise.resolve(false);
    }
    this.s.outcomes.push({ ...row });
    return Promise.resolve(true);
  }

  findNotificationOutcome(
    appointmentId: string,
    outcomeRef: string,
  ): Promise<NotificationOutcomeRow | undefined> {
    const o = this.s.outcomes.find(
      (x) => x.appointment_id === appointmentId && x.outcome_ref === outcomeRef,
    );
    return Promise.resolve(o ? { ...o } : undefined);
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({
      topic,
      envelope: JSON.parse(JSON.stringify(envelope)) as EventEnvelope<Record<string, unknown>>,
    });
    return Promise.resolve();
  }
}

/** Deferred occupancy constraint: booked_count equals seat-holding appointments, per slot. */
function assertOccupancy(s: TenantState): void {
  for (const slot of s.slots.values()) {
    if (slot.booked_count < 0 || slot.booked_count > slot.capacity) throw pgError('23514');
    let holding = 0;
    for (const a of s.appointments.values()) {
      if (a.slot_id === slot.slot_id && a.lifecycle_status !== 'CANCELLED') holding += 1;
    }
    if (holding !== slot.booked_count) throw pgError('55000');
  }
}

/**
 * Tenant-partitioned store with all-or-nothing, serialised transactions. Serialisation stands in
 * for the slot row lock; the real concurrency proof runs against PostgreSQL (integration suite).
 */
export class MemorySchedulerRepository implements SchedulerRepository {
  private readonly als = new AsyncLocalStorage<true>();
  private readonly tenants = new Map<string, TenantState>();
  private queue: Promise<unknown> = Promise.resolve();
  txCount = 0;

  tenant(id: string): TenantState {
    let s = this.tenants.get(id);
    if (!s) {
      s = emptyTenant();
      this.tenants.set(id, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp056Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    const tenantId = ctx.tenant_id;
    const run = async (): Promise<T> => {
      this.txCount += 1;
      const work = cloneTenant(this.tenant(tenantId));
      const result = await this.als.run(true, () => fn(new MemoryTx(work)));
      assertOccupancy(work);
      this.tenants.set(tenantId, work);
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
