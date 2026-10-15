import type { RequestContext } from '@serviceform/contracts';
import type {
  AppointmentEventLogRow,
  AppointmentRecord,
  AppointmentTypeRecord,
  SlotRecord,
} from '../../../../services/cmp-056-scheduler/src/domain/appointment.js';
import { Cmp056Error } from '../../../../services/cmp-056-scheduler/src/errors.js';
import type {
  SchedulerRepository,
  SchedulerTx,
} from '../../../../services/cmp-056-scheduler/src/repo/types.js';
import type {
  ConsentRecord,
  OperatorActionRecord,
  RepresentationRecord,
  SessionAggregate,
  SessionRecord,
} from '../../../../services/cmp-057-assisted-service/src/domain/session.js';
import { Cmp057Error } from '../../../../services/cmp-057-assisted-service/src/errors.js';
import type {
  AssistedReadTx,
  AssistedRepository,
  AssistedTx,
} from '../../../../services/cmp-057-assisted-service/src/repo/types.js';

export interface OutboxRow {
  topic: string;
  envelope: { event_type: string; tenant_id: string | null; data: object };
}

interface IdemRow {
  fingerprint: string;
  response?: { status: number; body: unknown };
}

/**
 * Tenant-partitioned transaction store: each tenant has an isolated partition (stands in for RLS),
 * commits are all-or-nothing and nested transactions are refused.
 */
class Partitioned<S extends { outbox: OutboxRow[]; idem: Map<string, IdemRow> }> {
  private readonly parts = new Map<string, S>();
  depth = 0;
  constructor(private readonly empty: () => S) {}

  tenant(id: string): S {
    let s = this.parts.get(id);
    if (!s) {
      s = this.empty();
      this.parts.set(id, s);
    }
    return s;
  }

  tenants(): string[] {
    return [...this.parts.keys()];
  }

  async run<T>(ctx: RequestContext, fn: (s: S) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Error('tenant required');
    if (this.depth > 0) throw new Error('nested transaction');
    const s = this.tenant(ctx.tenant_id);
    const backup = structuredClone(s);
    this.depth += 1;
    try {
      return await fn(s);
    } catch (err) {
      Object.assign(s, backup);
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

function claim(
  map: Map<string, IdemRow>,
  p: { principalId: string; endpoint: string; key: string; fingerprint: string },
  conflict: () => Error,
): { status: number; body: unknown } | 'claimed' {
  const id = `${p.principalId}|${p.endpoint}|${p.key}`;
  const existing = map.get(id);
  if (!existing) {
    map.set(id, { fingerprint: p.fingerprint });
    return 'claimed';
  }
  if (existing.fingerprint !== p.fingerprint || !existing.response) throw conflict();
  return structuredClone(existing.response);
}

function complete(
  map: Map<string, IdemRow>,
  p: { principalId: string; endpoint: string; key: string; status: number; body: unknown },
): void {
  const row = map.get(`${p.principalId}|${p.endpoint}|${p.key}`);
  if (row) row.response = structuredClone({ status: p.status, body: p.body });
}

interface SchedulerState {
  types: Map<string, AppointmentTypeRecord>;
  slots: Map<string, SlotRecord>;
  appointments: Map<string, AppointmentRecord>;
  log: AppointmentEventLogRow[];
  outbox: OutboxRow[];
  idem: Map<string, IdemRow>;
}

export class MemorySchedulerRepository implements SchedulerRepository {
  readonly store = new Partitioned<SchedulerState>(() => ({
    types: new Map(),
    slots: new Map(),
    appointments: new Map(),
    log: [],
    outbox: [],
    idem: new Map(),
  }));

  inTransaction(): boolean {
    return this.store.depth > 0;
  }

  withTx<T>(ctx: RequestContext, fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    return this.store.run(ctx, (s) => {
      const tx: SchedulerTx = {
        claimIdempotency: async (p) => claim(s.idem, p, () => new Cmp056Error('SF-APP-002')),
        completeIdempotency: async (p) => complete(s.idem, p),
        insertType: async (row) => void s.types.set(row.appointment_type_id, { ...row }),
        getType: async (id) => s.types.get(id),
        getTypeByRef: async (ref) =>
          [...s.types.values()].find((t) => t.appointment_type_ref === ref),
        insertSlot: async (row) => void s.slots.set(row.slot_id, { ...row }),
        getSlot: async (id) => s.slots.get(id),
        getSlotByRef: async (ref) => [...s.slots.values()].find((r) => r.slot_ref === ref),
        listAvailableSlots: async (typeId) =>
          [...s.slots.values()].filter(
            (r) =>
              r.booked_count < r.capacity &&
              (typeId === undefined || r.appointment_type_id === typeId),
          ),
        updateSlotBooked: async (row) => void s.slots.set(row.slot_id, { ...row }),
        insertAppointment: async (row) => void s.appointments.set(row.appointment_id, { ...row }),
        getAppointment: async (id) => {
          const r = s.appointments.get(id);
          return r ? { ...r } : undefined;
        },
        updateAppointment: async (row) => void s.appointments.set(row.appointment_id, { ...row }),
        insertEventLog: async (row) => void s.log.push({ ...row }),
        insertOutbox: async (envelope, topic) =>
          void s.outbox.push({
            topic,
            envelope: structuredClone(envelope) as OutboxRow['envelope'],
          }),
      };
      return fn(tx);
    });
  }
}

interface AssistedState {
  sessions: Map<string, SessionRecord>;
  representations: Map<string, RepresentationRecord>;
  consents: Map<string, ConsentRecord>;
  actions: OperatorActionRecord[];
  outbox: OutboxRow[];
  idem: Map<string, IdemRow>;
}

export class MemoryAssistedRepository implements AssistedRepository {
  readonly store = new Partitioned<AssistedState>(() => ({
    sessions: new Map(),
    representations: new Map(),
    consents: new Map(),
    actions: [],
    outbox: [],
    idem: new Map(),
  }));

  inTransaction(): boolean {
    return this.store.depth > 0;
  }

  private read(s: AssistedState): AssistedReadTx {
    return {
      getSession: async (id) => {
        const session = s.sessions.get(id);
        if (!session) return undefined;
        const agg: SessionAggregate = { session: { ...session } };
        const rep = s.representations.get(id);
        const con = s.consents.get(id);
        if (rep) agg.representation = { ...rep };
        if (con) agg.consent = { ...con };
        return agg;
      },
      listActions: async (id) =>
        s.actions.filter((a) => a.session_id === id).map((a) => ({ ...a })),
    };
  }

  withReadTx<T>(ctx: RequestContext, fn: (tx: AssistedReadTx) => Promise<T>): Promise<T> {
    return this.store.run(ctx, (s) => fn(this.read(s)));
  }

  withTx<T>(ctx: RequestContext, fn: (tx: AssistedTx) => Promise<T>): Promise<T> {
    return this.store.run(ctx, (s) => {
      const r = this.read(s);
      const tx: AssistedTx = {
        ...r,
        getSessionForUpdate: r.getSession,
        claimIdempotency: async (p) => claim(s.idem, p, () => new Cmp057Error('SF-APP-002')),
        completeIdempotency: async (p) => complete(s.idem, p),
        insertSession: async (row) => void s.sessions.set(row.session_id, { ...row }),
        updateSession: async (row) => void s.sessions.set(row.session_id, { ...row }),
        insertRepresentation: async (row) => void s.representations.set(row.session_id, { ...row }),
        insertConsent: async (row) => void s.consents.set(row.session_id, { ...row }),
        insertAction: async (row) => void s.actions.push({ ...row }),
        insertOutbox: async (envelope, topic) =>
          void s.outbox.push({
            topic,
            envelope: structuredClone(envelope) as OutboxRow['envelope'],
          }),
      };
      return fn(tx);
    });
  }
}
