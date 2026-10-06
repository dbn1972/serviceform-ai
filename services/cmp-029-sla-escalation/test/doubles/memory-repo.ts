import type { ClockState } from '../../src/domain/clock.js';
import { Cmp029Error } from '../../src/errors.js';
import type {
  CalendarRow,
  ClockRow,
  HistoryRow,
  PolicyRow,
  SlaRepository,
  SlaTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

interface TenantData {
  calendars: Map<string, CalendarRow>;
  policies: Map<string, PolicyRow>;
  clocks: Map<string, ClockRow>;
  history: HistoryRow[];
  idempotency: Map<string, { fingerprint: string; response?: StoredIdempotent }>;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

const emptyTenant = (): TenantData => ({
  calendars: new Map(),
  policies: new Map(),
  clocks: new Map(),
  history: [],
  idempotency: new Map(),
  outbox: [],
});

/**
 * Tenant-keyed in-memory repository. Every operation is scoped to the transaction's tenant, the
 * unit-level analogue of FORCE RLS; the real boundary is proven in test/integration.
 */
export class MemorySlaRepository implements SlaRepository {
  private tenants = new Map<string, TenantData>();
  private active = false;

  inTransaction(): boolean {
    return this.active;
  }

  tenant(tenantId: string): TenantData {
    let t = this.tenants.get(tenantId);
    if (!t) {
      t = emptyTenant();
      this.tenants.set(tenantId, t);
    }
    return t;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: SlaTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp029Error('SF-TEN-001');
    if (this.active) throw new Cmp029Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    const snapshot = structuredClone(this.tenants);
    this.active = true;
    try {
      return await fn(new MemoryTx(this.tenant(ctx.tenant_id)));
    } catch (err) {
      this.tenants = snapshot;
      throw err;
    } finally {
      this.active = false;
    }
  }
}

class MemoryTx implements SlaTx {
  constructor(private readonly d: TenantData) {}

  private idemKey(p: { principalId: string; endpoint: string; key: string }): string {
    return `${p.principalId}|${p.endpoint}|${p.key}`;
  }

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = this.idemKey(p);
    const existing = this.d.idempotency.get(k);
    if (!existing) {
      this.d.idempotency.set(k, { fingerprint: p.fingerprint });
      return Promise.resolve('claimed');
    }
    if (existing.fingerprint !== p.fingerprint)
      return Promise.reject(new Cmp029Error('SF-APP-002'));
    if (existing.response) return Promise.resolve(existing.response);
    return Promise.reject(new Cmp029Error('SF-APP-002'));
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const existing = this.d.idempotency.get(this.idemKey(p));
    if (existing) existing.response = { status: p.status, body: structuredClone(p.body) };
    return Promise.resolve();
  }

  insertCalendar(row: CalendarRow & { created_by: string }): Promise<void> {
    this.d.calendars.set(row.calendar_id, structuredClone(row));
    return Promise.resolve();
  }
  getCalendar(id: string): Promise<CalendarRow | null> {
    return Promise.resolve(structuredClone(this.d.calendars.get(id) ?? null));
  }
  latestCalendarVersion(code: string): Promise<number> {
    const versions = [...this.d.calendars.values()]
      .filter((c) => c.calendar_code === code)
      .map((c) => c.version_no);
    return Promise.resolve(versions.length ? Math.max(...versions) : 0);
  }

  insertPolicy(row: PolicyRow & { created_by: string }): Promise<void> {
    this.d.policies.set(row.policy_id, structuredClone(row));
    return Promise.resolve();
  }
  getPolicy(id: string): Promise<PolicyRow | null> {
    return Promise.resolve(structuredClone(this.d.policies.get(id) ?? null));
  }
  latestPolicyVersion(code: string): Promise<number> {
    const versions = [...this.d.policies.values()]
      .filter((c) => c.policy_code === code)
      .map((c) => c.version_no);
    return Promise.resolve(versions.length ? Math.max(...versions) : 0);
  }
  retirePolicy(id: string): Promise<void> {
    const p = this.d.policies.get(id);
    if (p) p.status = 'RETIRED';
    return Promise.resolve();
  }

  insertClock(row: ClockRow): Promise<void> {
    this.d.clocks.set(row.clock_id, structuredClone(row));
    return Promise.resolve();
  }
  getClock(id: string): Promise<ClockRow | null> {
    return Promise.resolve(structuredClone(this.d.clocks.get(id) ?? null));
  }
  lockClock(id: string): Promise<ClockRow | null> {
    return this.getClock(id);
  }
  findClock(applicationId: string, stageCode: string): Promise<ClockRow | null> {
    const found = [...this.d.clocks.values()].find(
      (c) => c.application_id === applicationId && c.stage_code === stageCode,
    );
    return Promise.resolve(structuredClone(found ?? null));
  }
  clocksForApplication(applicationId: string): Promise<ClockRow[]> {
    return Promise.resolve(
      structuredClone(
        [...this.d.clocks.values()].filter((c) => c.application_id === applicationId),
      ),
    );
  }
  updateClock(id: string, state: ClockState, expectedVersion: number, now: Date): Promise<void> {
    const row = this.d.clocks.get(id);
    if (!row || row.aggregate_version !== expectedVersion) {
      return Promise.reject(new Cmp029Error('SF-APP-002'));
    }
    Object.assign(row, state, {
      aggregate_version: expectedVersion + 1,
      updated_at: now.toISOString(),
    });
    return Promise.resolve();
  }

  appendHistory(row: HistoryRow): Promise<void> {
    this.d.history.push(structuredClone(row));
    return Promise.resolve();
  }
  listHistory(clockId: string): Promise<HistoryRow[]> {
    return Promise.resolve(
      structuredClone(
        this.d.history
          .filter((h) => h.clock_id === clockId)
          .sort((a, b) => a.sequence_no - b.sequence_no),
      ),
    );
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.d.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
