import type {
  ConsentRecord,
  OperatorActionRecord,
  RepresentationRecord,
  SessionAggregate,
  SessionRecord,
} from '../../src/domain/session.js';
import { Cmp057Error } from '../../src/errors.js';
import type {
  AssistedReadTx,
  AssistedRepository,
  AssistedTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  sessions: Map<string, SessionRecord>;
  representations: Map<string, RepresentationRecord>;
  consents: Map<string, ConsentRecord>;
  actions: OperatorActionRecord[];
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return {
    sessions: new Map(),
    representations: new Map(),
    consents: new Map(),
    actions: [],
    idempotency: new Map(),
    outbox: [],
  };
}

/**
 * In-memory tenant-partitioned repository with all-or-nothing transactions. Mirrors the
 * database identity and distinctness guards that matter to the service so unit tests cannot
 * pass on behaviour the database would refuse.
 */
export class MemoryAssistedRepository implements AssistedRepository {
  private readonly stores = new Map<string, TenantStore>();
  private depth = 0;
  failNextCommit = false;
  txCount = 0;
  readOnlyDepth = 0;

  tenant(tenantId: string): TenantStore {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = emptyStore();
      this.stores.set(tenantId, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.depth > 0 || this.readOnlyDepth > 0;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: AssistedTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp057Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp057Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
      store.sessions = new Map(backup.sessions);
      store.representations = new Map(backup.representations);
      store.consents = new Map(backup.consents);
      store.actions = [...backup.actions];
      store.idempotency = new Map(backup.idempotency);
      store.outbox = [...backup.outbox];
      throw err;
    } finally {
      this.depth -= 1;
    }
  }

  async withReadTx<T>(ctx: RequestContext, fn: (tx: AssistedReadTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp057Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp057Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    this.readOnlyDepth += 1;
    try {
      return await fn(new MemoryReadTx(this.tenant(ctx.tenant_id)));
    } finally {
      this.readOnlyDepth -= 1;
    }
  }
}

class MemoryReadTx implements AssistedReadTx {
  constructor(protected readonly s: TenantStore) {}

  getSession(sessionId: string): Promise<SessionAggregate | undefined> {
    const session = this.s.sessions.get(sessionId);
    if (!session) return Promise.resolve(undefined);
    const agg: SessionAggregate = { session: structuredClone(session) };
    const rep = this.s.representations.get(sessionId);
    const consent = this.s.consents.get(sessionId);
    if (rep) agg.representation = structuredClone(rep);
    if (consent) agg.consent = structuredClone(consent);
    return Promise.resolve(agg);
  }

  listActions(sessionId: string): Promise<OperatorActionRecord[]> {
    return Promise.resolve(
      this.s.actions
        .filter((a) => a.session_id === sessionId)
        .sort((a, b) => a.sequence - b.sequence)
        .map((a) => structuredClone(a)),
    );
  }
}

class MemoryTx extends MemoryReadTx implements AssistedTx {
  getSessionForUpdate(sessionId: string): Promise<SessionAggregate | undefined> {
    return this.getSession(sessionId);
  }

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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp057Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp057Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const id = `${p.principalId}|${p.endpoint}|${p.key}`;
    const existing = this.s.idempotency.get(id);
    if (!existing) throw new Cmp057Error('SF-SYS-001');
    existing.status = 'COMPLETED';
    existing.response = { status: p.status, body: structuredClone(p.body) };
    return Promise.resolve();
  }

  insertSession(row: SessionRecord): Promise<void> {
    if (row.applied_by_actor_id.toLowerCase() === row.applied_for_citizen_id.toLowerCase()) {
      throw new Cmp057Error('SF-APP-001', { details: [{ code: 'APPLIED_BY_NOT_DISTINCT' }] });
    }
    if (this.s.sessions.has(row.session_id)) throw new Cmp057Error('SF-APP-002');
    this.s.sessions.set(row.session_id, structuredClone(row));
    return Promise.resolve();
  }

  updateSession(row: SessionRecord): Promise<void> {
    const cur = this.s.sessions.get(row.session_id);
    if (!cur) throw new Cmp057Error('SF-SYS-002');
    if (cur.session_version !== row.session_version - 1) throw new Cmp057Error('SF-APP-001');
    if (row.applied_by_actor_id.toLowerCase() === row.applied_for_citizen_id.toLowerCase()) {
      throw new Cmp057Error('SF-APP-001', { details: [{ code: 'APPLIED_BY_NOT_DISTINCT' }] });
    }
    this.s.sessions.set(row.session_id, structuredClone(row));
    return Promise.resolve();
  }

  insertRepresentation(row: RepresentationRecord): Promise<void> {
    if (this.s.representations.has(row.session_id)) throw new Cmp057Error('SF-APP-002');
    this.s.representations.set(row.session_id, structuredClone(row));
    return Promise.resolve();
  }

  insertConsent(row: ConsentRecord): Promise<void> {
    if (this.s.consents.has(row.session_id)) throw new Cmp057Error('SF-APP-002');
    this.s.consents.set(row.session_id, structuredClone(row));
    return Promise.resolve();
  }

  insertAction(row: OperatorActionRecord): Promise<void> {
    this.s.actions.push(structuredClone(row));
    return Promise.resolve();
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
