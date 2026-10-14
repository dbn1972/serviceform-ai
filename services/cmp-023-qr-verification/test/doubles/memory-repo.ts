import type { VerificationTokenRecord } from '../../src/domain/token.js';
import { Cmp023Error } from '../../src/errors.js';
import type { QrRepository, QrTx, StoredIdempotent } from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantStore {
  tokens: Map<string, VerificationTokenRecord>;
  idempotency: Map<
    string,
    { fingerprint: string; status: 'IN_PROGRESS' | 'COMPLETED'; response?: StoredIdempotent }
  >;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

function emptyStore(): TenantStore {
  return { tokens: new Map(), idempotency: new Map(), outbox: [] };
}

/**
 * Tenant-partitioned in-memory repository with all-or-nothing transactions. Mirrors the database
 * guards the service relies on (unique opaque token and one token per credential per tenant).
 */
export class MemoryQrRepository implements QrRepository {
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

  async withTx<T>(ctx: RequestContext, fn: (tx: QrTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp023Error('SF-TEN-001');
    if (this.depth > 0)
      throw new Cmp023Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
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
      Object.assign(store, backup);
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

class MemoryTx implements QrTx {
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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp023Error('SF-APP-002');
    if (existing.status === 'COMPLETED' && existing.response) {
      return Promise.resolve(structuredClone(existing.response));
    }
    throw new Cmp023Error('SF-APP-002');
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

  insertToken(row: VerificationTokenRecord): Promise<void> {
    for (const t of this.s.tokens.values()) {
      if (t.opaque_token === row.opaque_token || t.credential_id === row.credential_id) {
        throw new Cmp023Error('SF-APP-002');
      }
    }
    if (this.s.tokens.has(row.token_id)) throw new Cmp023Error('SF-APP-002');
    this.s.tokens.set(row.token_id, structuredClone(row));
    return Promise.resolve();
  }

  getToken(tokenId: string): Promise<VerificationTokenRecord | undefined> {
    const t = this.s.tokens.get(tokenId);
    return Promise.resolve(t ? structuredClone(t) : undefined);
  }

  private find(pred: (t: VerificationTokenRecord) => boolean): VerificationTokenRecord | undefined {
    for (const t of this.s.tokens.values()) if (pred(t)) return structuredClone(t);
    return undefined;
  }

  getTokenByOpaque(opaqueToken: string): Promise<VerificationTokenRecord | undefined> {
    return Promise.resolve(this.find((t) => t.opaque_token === opaqueToken));
  }

  getTokenByCredential(credentialId: string): Promise<VerificationTokenRecord | undefined> {
    return Promise.resolve(this.find((t) => t.credential_id === credentialId));
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({ topic, envelope: structuredClone(envelope) });
    return Promise.resolve();
  }
}
