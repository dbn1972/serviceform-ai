import { canTransition } from '../../src/domain/model.js';
import { Cmp025Error } from '../../src/errors.js';
import type {
  AttemptRow,
  DispatchRow,
  NotificationRepository,
  NotificationTx,
  StoredIdempotent,
  TemplateRow,
} from '../../src/repo/types.js';
import type { Channel } from '../../src/domain/model.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantData {
  templates: TemplateRow[];
  dispatches: Map<string, DispatchRow>;
  attempts: AttemptRow[];
  idempotency: Map<string, { fingerprint: string; response?: StoredIdempotent }>;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

const emptyTenant = (): TenantData => ({
  templates: [],
  dispatches: new Map(),
  attempts: [],
  idempotency: new Map(),
  outbox: [],
});

export class MemoryNotificationRepository implements NotificationRepository {
  private tenants = new Map<string, TenantData>();
  private active = false;
  /** Number of transactions opened; lets tests prove provider I/O happens between transactions. */
  txCount = 0;

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

  async withTx<T>(ctx: RequestContext, fn: (tx: NotificationTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp025Error('SF-TEN-001');
    if (this.active) throw new Cmp025Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
    const snapshot = structuredClone(this.tenants);
    this.active = true;
    this.txCount += 1;
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

class MemoryTx implements NotificationTx {
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
    if (existing.fingerprint !== p.fingerprint) {
      return Promise.reject(new Cmp025Error('SF-APP-002'));
    }
    if (existing.response) return Promise.resolve(existing.response);
    return Promise.reject(new Cmp025Error('SF-APP-002'));
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const rec = this.d.idempotency.get(this.idemKey(p));
    if (rec) rec.response = { status: p.status, body: structuredClone(p.body) };
    return Promise.resolve();
  }

  insertTemplate(row: TemplateRow): Promise<void> {
    const dup = this.d.templates.some(
      (t) =>
        t.template_ref === row.template_ref &&
        t.template_version === row.template_version &&
        t.channel === row.channel &&
        t.locale === row.locale,
    );
    if (dup) return Promise.reject(new Cmp025Error('SF-APP-002'));
    this.d.templates.push(structuredClone(row));
    return Promise.resolve();
  }

  getTemplate(
    ref: string,
    channel: Channel,
    locale: string,
    version?: number,
  ): Promise<TemplateRow | undefined> {
    const rows = this.d.templates
      .filter(
        (t) =>
          t.template_ref === ref &&
          t.channel === channel &&
          t.locale === locale &&
          (version === undefined || t.template_version === version),
      )
      .sort((a, b) => b.template_version - a.template_version);
    return Promise.resolve(rows[0] ? structuredClone(rows[0]) : undefined);
  }

  listTemplateVersions(ref: string): Promise<TemplateRow[]> {
    return Promise.resolve(
      this.d.templates
        .filter((t) => t.template_ref === ref)
        .sort((a, b) => a.template_version - b.template_version)
        .map((t) => structuredClone(t)),
    );
  }

  insertDispatch(row: DispatchRow): Promise<void> {
    if ([...this.d.dispatches.values()].some((r) => r.idempotency_key === row.idempotency_key)) {
      return Promise.reject(new Cmp025Error('SF-APP-002'));
    }
    if ((row.connector_mode === 'SIMULATED') !== (row.simulation_marker !== null)) {
      return Promise.reject(new Cmp025Error('SF-SYS-003'));
    }
    this.d.dispatches.set(row.dispatch_id, structuredClone(row));
    return Promise.resolve();
  }

  getDispatch(id: string): Promise<DispatchRow | undefined> {
    const row = this.d.dispatches.get(id);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  updateDispatch(row: DispatchRow): Promise<void> {
    const cur = this.d.dispatches.get(row.dispatch_id);
    if (!cur) return Promise.reject(new Cmp025Error('SF-SYS-002'));
    if (!canTransition(cur.status, row.status)) {
      return Promise.reject(new Cmp025Error('SF-APP-001'));
    }
    if (row.aggregate_version !== cur.aggregate_version + 1) {
      return Promise.reject(new Cmp025Error('SF-APP-001'));
    }
    this.d.dispatches.set(row.dispatch_id, structuredClone(row));
    return Promise.resolve();
  }

  claimDue(p: {
    limit: number;
    now: Date;
    leaseOwner: string;
    leaseMs: number;
  }): Promise<DispatchRow[]> {
    const due = [...this.d.dispatches.values()]
      .filter(
        (r) =>
          (r.status === 'QUEUED' && Date.parse(r.next_attempt_at) <= p.now.getTime()) ||
          (r.status === 'SENDING' &&
            r.lease_expires_at !== null &&
            Date.parse(r.lease_expires_at) <= p.now.getTime()),
      )
      .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
      .slice(0, p.limit);
    const out: DispatchRow[] = [];
    for (const r of due) {
      r.status = 'SENDING';
      r.attempts = Math.min(r.attempts + 1, r.max_attempts + 1);
      r.lease_owner = p.leaseOwner;
      r.lease_expires_at = new Date(p.now.getTime() + p.leaseMs).toISOString();
      r.aggregate_version += 1;
      r.updated_at = p.now.toISOString();
      out.push(structuredClone(r));
    }
    return Promise.resolve(out);
  }

  insertAttempt(row: AttemptRow): Promise<void> {
    if (
      this.d.attempts.some(
        (a) => a.dispatch_id === row.dispatch_id && a.attempt_no === row.attempt_no,
      )
    ) {
      return Promise.reject(new Cmp025Error('SF-APP-002'));
    }
    this.d.attempts.push(structuredClone(row));
    return Promise.resolve();
  }

  listAttempts(dispatchId: string): Promise<AttemptRow[]> {
    return Promise.resolve(
      this.d.attempts
        .filter((a) => a.dispatch_id === dispatchId)
        .sort((a, b) => a.attempt_no - b.attempt_no)
        .map((a) => structuredClone(a)),
    );
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.d.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
