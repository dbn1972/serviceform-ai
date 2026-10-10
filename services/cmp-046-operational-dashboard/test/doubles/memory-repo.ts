import { Cmp046Error } from '../../src/errors.js';
import type { ViewCode } from '../../src/domain/model.js';
import type {
  OpsRepository,
  OpsTx,
  RefreshLogRow,
  SnapshotRow,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  snapshots: Map<ViewCode, SnapshotRow>;
  refreshLog: RefreshLogRow[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return { snapshots: new Map(), refreshLog: [], idempotency: new Map(), outbox: [] };
}

/** In-memory tenant-partitioned repository with all-or-nothing transactions. */
export class MemoryOpsRepository implements OpsRepository {
  private readonly stores = new Map<string, TenantStore>();
  private depth = 0;
  failNextCommit = false;

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

  async withTx<T>(ctx: RequestContext, fn: (tx: OpsTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp046Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp046Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    const store = this.tenant(ctx.tenant_id);
    const backup = structuredClone(store);
    this.depth += 1;
    try {
      const result = await fn(new MemoryTx(store));
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('commit failed');
      }
      return result;
    } catch (err) {
      store.snapshots = backup.snapshots;
      store.refreshLog = backup.refreshLog;
      store.idempotency = backup.idempotency;
      store.outbox = backup.outbox;
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

class MemoryTx implements OpsTx {
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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp046Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(existing.response);
    }
    throw new Cmp046Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const id = `${p.principalId}|${p.endpoint}|${p.key}`;
    const row = this.s.idempotency.get(id);
    if (row) {
      row.status = 'COMPLETED';
      row.response = { status: p.status, body: p.body };
    }
    return Promise.resolve();
  }

  getSnapshot(viewCode: ViewCode): Promise<SnapshotRow | undefined> {
    const row = this.s.snapshots.get(viewCode);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  getSnapshotForUpdate(viewCode: ViewCode): Promise<SnapshotRow | undefined> {
    return this.getSnapshot(viewCode);
  }

  listSnapshots(): Promise<SnapshotRow[]> {
    return Promise.resolve([...this.s.snapshots.values()].map((r) => structuredClone(r)));
  }

  insertSnapshot(row: SnapshotRow): Promise<void> {
    if (this.s.snapshots.has(row.view_code)) throw new Cmp046Error('SF-APP-002');
    this.s.snapshots.set(row.view_code, structuredClone(row));
    return Promise.resolve();
  }

  updateSnapshot(row: SnapshotRow): Promise<void> {
    const old = this.s.snapshots.get(row.view_code);
    if (!old || row.snapshot_version !== old.snapshot_version + 1) {
      throw new Cmp046Error('SF-APP-001');
    }
    this.s.snapshots.set(row.view_code, structuredClone(row));
    return Promise.resolve();
  }

  insertRefreshLog(row: RefreshLogRow): Promise<void> {
    this.s.refreshLog.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
