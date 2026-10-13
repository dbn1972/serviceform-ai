import { Cmp006Error } from '../../src/errors.js';
import type {
  DiscoveryQueryRecord,
  DiscoveryRepository,
  DiscoveryResultRecord,
  DiscoverySelectionRecord,
  DiscoveryTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  queries: Map<string, DiscoveryQueryRecord>;
  results: DiscoveryResultRecord[];
  selections: DiscoverySelectionRecord[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return { queries: new Map(), results: [], selections: [], idempotency: new Map(), outbox: [] };
}

/**
 * Tenant-partitioned in-memory repository with all-or-nothing transactions. It mirrors the
 * database guards the service relies on (owner/result composite FKs, one selection per service).
 */
export class MemoryDiscoveryRepository implements DiscoveryRepository {
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

  async withTx<T>(ctx: RequestContext, fn: (tx: DiscoveryTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp006Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp006Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    const store = this.tenant(ctx.tenant_id);
    const backup = structuredClone(store);
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
      Object.assign(store, backup);
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

class MemoryTx implements DiscoveryTx {
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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp006Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp006Error('SF-APP-002');
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

  insertQuery(row: DiscoveryQueryRecord): Promise<void> {
    if (this.s.queries.has(row.query_id)) throw new Cmp006Error('SF-APP-002');
    this.s.queries.set(row.query_id, structuredClone(row));
    return Promise.resolve();
  }

  insertResults(rows: DiscoveryResultRecord[]): Promise<void> {
    for (const r of rows) {
      const q = this.s.queries.get(r.query_id);
      if (!q || q.catalogue_version_id !== r.catalogue_version_id) {
        throw new Cmp006Error('SF-SYS-002');
      }
      this.s.results.push(structuredClone(r));
    }
    return Promise.resolve();
  }

  getQuery(queryId: string): Promise<DiscoveryQueryRecord | undefined> {
    const q = this.s.queries.get(queryId);
    return Promise.resolve(q ? structuredClone(q) : undefined);
  }

  getResults(queryId: string): Promise<DiscoveryResultRecord[]> {
    return Promise.resolve(
      this.s.results
        .filter((r) => r.query_id === queryId)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => structuredClone(r)),
    );
  }

  insertSelection(row: DiscoverySelectionRecord): Promise<void> {
    const q = this.s.queries.get(row.query_id);
    const r = this.s.results.find(
      (x) =>
        x.query_id === row.query_id &&
        x.service_id === row.service_id &&
        x.service_binding_version_id === row.service_binding_version_id &&
        x.catalogue_version_id === row.catalogue_version_id,
    );
    if (!q || q.actor_type !== 'CITIZEN' || q.actor_id !== row.actor_id || !r) {
      throw new Cmp006Error('SF-SYS-002');
    }
    if (
      this.s.selections.some((x) => x.query_id === row.query_id && x.service_id === row.service_id)
    ) {
      throw new Cmp006Error('SF-APP-002');
    }
    this.s.selections.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
