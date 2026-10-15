import type {
  FulfilmentTaskRecord,
  PrivacyRequestRecord,
  ScopeItem,
} from '../../src/domain/request.js';
import { Cmp061Error } from '../../src/errors.js';
import type {
  DecisionLogRow,
  PrivacyRepository,
  PrivacyTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  requests: Map<string, PrivacyRequestRecord>;
  scope: Map<string, ScopeItem[]>;
  tasks: Map<string, FulfilmentTaskRecord>;
  decisions: DecisionLogRow[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return {
    requests: new Map(),
    scope: new Map(),
    tasks: new Map(),
    decisions: [],
    idempotency: new Map(),
    outbox: [],
  };
}

/**
 * In-memory tenant-partitioned repository mirroring the SQL lifecycle guards that unit tests
 * must not bypass (forward-only transitions, task creation only when TASKS_REQUESTED, frozen
 * markers always true).
 */
export class MemoryPrivacyRepository implements PrivacyRepository {
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

  async withTx<T>(ctx: RequestContext, fn: (tx: PrivacyTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp061Error('SF-TEN-001');
    if (this.depth > 0) {
      throw new Cmp061Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
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

class MemoryTx implements PrivacyTx {
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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp061Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp061Error('SF-APP-002');
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

  insertRequest(row: PrivacyRequestRecord): Promise<void> {
    if (this.s.requests.has(row.request_id) || row.request_version !== 1) {
      throw new Cmp061Error('SF-APP-002');
    }
    if (row.lifecycle_status !== 'SUBMITTED') throw new Cmp061Error('SF-APP-001');
    this.s.requests.set(row.request_id, structuredClone(row));
    return Promise.resolve();
  }

  insertScope(
    _tenantId: string,
    requestId: string,
    items: readonly ScopeItem[],
    _createdAt: string,
  ): Promise<void> {
    const req = this.s.requests.get(requestId);
    if (!req || req.lifecycle_status !== 'SUBMITTED' || req.request_version !== 1) {
      throw new Cmp061Error('SF-APP-001');
    }
    this.s.scope.set(requestId, structuredClone([...items]));
    return Promise.resolve();
  }

  getRequest(requestId: string): Promise<PrivacyRequestRecord | undefined> {
    const row = this.s.requests.get(requestId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  listRequestsForSubject(subjectActorId: string): Promise<PrivacyRequestRecord[]> {
    return Promise.resolve(
      [...this.s.requests.values()]
        .filter((r) => r.subject_actor_id === subjectActorId)
        .map((r) => structuredClone(r)),
    );
  }

  listScope(requestId: string): Promise<ScopeItem[]> {
    return Promise.resolve(structuredClone(this.s.scope.get(requestId) ?? []));
  }

  updateRequest(row: PrivacyRequestRecord): Promise<void> {
    const old = this.s.requests.get(row.request_id);
    if (!old || row.request_version !== old.request_version + 1) {
      throw new Cmp061Error('SF-APP-001');
    }
    this.s.requests.set(row.request_id, structuredClone(row));
    return Promise.resolve();
  }

  insertTask(row: FulfilmentTaskRecord): Promise<void> {
    const parent = this.s.requests.get(row.request_id);
    if (!parent || parent.lifecycle_status !== 'TASKS_REQUESTED') {
      throw new Cmp061Error('SF-APP-001');
    }
    if (row.task_status !== 'REQUESTED' || row.task_version !== 1) {
      throw new Cmp061Error('SF-APP-001');
    }
    this.s.tasks.set(row.task_id, structuredClone(row));
    return Promise.resolve();
  }

  getTask(taskId: string): Promise<FulfilmentTaskRecord | undefined> {
    const row = this.s.tasks.get(taskId);
    return Promise.resolve(row ? structuredClone(row) : undefined);
  }

  listTasks(requestId: string): Promise<FulfilmentTaskRecord[]> {
    return Promise.resolve(
      [...this.s.tasks.values()]
        .filter((t) => t.request_id === requestId)
        .sort((a, b) => a.scope_seq - b.scope_seq)
        .map((t) => structuredClone(t)),
    );
  }

  updateTask(row: FulfilmentTaskRecord): Promise<void> {
    const old = this.s.tasks.get(row.task_id);
    if (!old || old.task_status !== 'REQUESTED' || row.task_version !== old.task_version + 1) {
      throw new Cmp061Error('SF-APP-001');
    }
    this.s.tasks.set(row.task_id, structuredClone(row));
    return Promise.resolve();
  }

  insertDecision(row: DecisionLogRow): Promise<void> {
    this.s.decisions.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
