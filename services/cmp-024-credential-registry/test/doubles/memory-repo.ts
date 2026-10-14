import type {
  RegistryEntryRecord,
  RegistryStatus,
  StatusHistoryRecord,
} from '../../src/domain/status.js';
import { Cmp024Error } from '../../src/errors.js';
import type {
  RegistryReadTx,
  RegistryRepository,
  RegistryTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  entries: Map<string, RegistryEntryRecord>;
  history: StatusHistoryRecord[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return { entries: new Map(), history: [], idempotency: new Map(), outbox: [] };
}

function cloneStore(s: TenantStore): TenantStore {
  return {
    entries: new Map([...s.entries].map(([k, v]) => [k, { ...v }])),
    history: [...s.history],
    idempotency: new Map([...s.idempotency].map(([k, v]) => [k, { ...v }])),
    outbox: [...s.outbox],
  };
}

const ALLOWED: Readonly<Record<RegistryStatus, readonly RegistryStatus[]>> = {
  REGISTERED: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED', 'REISSUED'],
  SUSPENDED: ['ACTIVE', 'REVOKED', 'REISSUED'],
  REVOKED: [],
  REISSUED: [],
};

/** Mirrors guard_entry/guard_history so unit tests cannot pass on writes PostgreSQL refuses. */
class MemoryTx implements RegistryTx {
  constructor(private readonly s: TenantStore) {}

  getEntry(credentialId: string): Promise<RegistryEntryRecord | undefined> {
    const e = this.s.entries.get(credentialId);
    return Promise.resolve(e ? { ...e } : undefined);
  }

  getEntryForUpdate(credentialId: string): Promise<RegistryEntryRecord | undefined> {
    return this.getEntry(credentialId);
  }

  listHistory(credentialId: string): Promise<StatusHistoryRecord[]> {
    return Promise.resolve(
      this.s.history
        .filter((h) => h.credential_id === credentialId)
        .sort((a, b) => a.sequence - b.sequence)
        .map((h) => ({ ...h })),
    );
  }

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.s.idempotency.get(k);
    if (!existing) {
      this.s.idempotency.set(k, { fingerprint: p.fingerprint, status: 'IN_PROGRESS' });
      return Promise.resolve('claimed');
    }
    if (existing.fingerprint !== p.fingerprint) throw new Cmp024Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(existing.response);
    }
    throw new Cmp024Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const k = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.s.idempotency.get(k);
    if (existing) {
      existing.status = 'COMPLETED';
      existing.response = { status: p.status, body: JSON.parse(JSON.stringify(p.body)) };
    }
    return Promise.resolve();
  }

  insertEntry(row: RegistryEntryRecord): Promise<void> {
    if (this.s.entries.has(row.credential_id))
      throw Object.assign(new Error('dup'), { code: '23505' });
    if (row.current_status !== 'REGISTERED' || row.status_version !== 1) {
      throw Object.assign(new Error('guard'), { code: 'P0001' });
    }
    this.s.entries.set(row.credential_id, { ...row });
    return Promise.resolve();
  }

  updateEntryStatus(row: RegistryEntryRecord): Promise<void> {
    const old = this.s.entries.get(row.credential_id);
    if (!old || old.status_version !== row.status_version - 1) throw new Cmp024Error('SF-APP-001');
    if (old.issuer_ref !== row.issuer_ref || old.registered_at !== row.registered_at) {
      throw Object.assign(new Error('immutable'), { code: '42501' });
    }
    if (!ALLOWED[old.current_status].includes(row.current_status)) {
      throw Object.assign(new Error('guard'), { code: 'P0001' });
    }
    if ((row.current_status === 'REISSUED') !== (row.superseded_by_credential_id !== null)) {
      throw Object.assign(new Error('check'), { code: '23514' });
    }
    this.s.entries.set(row.credential_id, { ...row });
    return Promise.resolve();
  }

  insertHistory(row: StatusHistoryRecord): Promise<void> {
    const cur = this.s.entries.get(row.credential_id);
    if (!cur) throw Object.assign(new Error('fk'), { code: '23503' });
    if (
      row.sequence !== cur.status_version ||
      row.to_status !== cur.current_status ||
      row.superseded_by_credential_id !== cur.superseded_by_credential_id
    ) {
      throw Object.assign(new Error('mismatch'), { code: 'P0001' });
    }
    if ((row.sequence === 1) !== (row.from_status === null)) {
      throw Object.assign(new Error('check'), { code: '23514' });
    }
    if (
      (row.to_status === 'SUSPENDED' || row.to_status === 'REVOKED') &&
      row.reason_code_ref === null
    ) {
      throw Object.assign(new Error('check'), { code: '23514' });
    }
    if (
      this.s.history.some(
        (h) => h.credential_id === row.credential_id && h.sequence === row.sequence,
      )
    ) {
      throw Object.assign(new Error('dup'), { code: '23505' });
    }
    this.s.history.push(Object.freeze({ ...row }) as StatusHistoryRecord);
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope });
    return Promise.resolve();
  }
}

/** In-memory tenant-partitioned repository with all-or-nothing transactions. */
export class MemoryRegistryRepository implements RegistryRepository {
  private readonly stores = new Map<string, TenantStore>();
  private depth = 0;
  writeTxCount = 0;
  readTxCount = 0;

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

  async withTx<T>(ctx: RequestContext, fn: (tx: RegistryTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp024Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp024Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    this.writeTxCount += 1;
    const live = this.tenant(ctx.tenant_id);
    const working = cloneStore(live);
    this.depth += 1;
    try {
      const out = await fn(new MemoryTx(working));
      this.stores.set(ctx.tenant_id, working);
      return out;
    } finally {
      this.depth -= 1;
    }
  }

  /** Like BEGIN READ ONLY: the read view has no mutators and any state change is rejected. */
  async withReadTx<T>(ctx: RequestContext, fn: (tx: RegistryReadTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp024Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp024Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    this.readTxCount += 1;
    const tenantId = ctx.tenant_id;
    const before = JSON.stringify(this.snapshot(tenantId));
    const inner = new MemoryTx(this.tenant(tenantId));
    const view: RegistryReadTx = Object.freeze({
      getEntry: (id: string) => inner.getEntry(id),
      listHistory: (id: string) => inner.listHistory(id),
    });
    this.depth += 1;
    try {
      const out = await fn(view);
      if (JSON.stringify(this.snapshot(tenantId)) !== before) {
        throw Object.assign(new Error('read only'), { code: '25006' });
      }
      return out;
    } finally {
      this.depth -= 1;
    }
  }

  snapshot(tenantId: string): object {
    const s = this.tenant(tenantId);
    return {
      entries: [...s.entries.values()],
      history: s.history,
      idempotency: [...s.idempotency.entries()],
      outbox: s.outbox.length,
    };
  }
}
