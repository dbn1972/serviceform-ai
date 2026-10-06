import { Cmp019Error } from '../../src/errors.js';
import type {
  DeficiencyRepository,
  DeficiencyTx,
  EvidenceRow,
  HistoryRow,
  ItemRow,
  NoticeRow,
  ResponseRow,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

export interface TenantData {
  notices: Map<string, NoticeRow>;
  items: ItemRow[];
  responses: Map<string, ResponseRow>;
  evidence: EvidenceRow[];
  history: HistoryRow[];
  idempotency: Map<string, { fingerprint: string; response?: StoredIdempotent }>;
  outbox: { topic: string; envelope: EventEnvelope<object> }[];
}

const emptyTenant = (): TenantData => ({
  notices: new Map(),
  items: [],
  responses: new Map(),
  evidence: [],
  history: [],
  idempotency: new Map(),
  outbox: [],
});

export class MemoryDeficiencyRepository implements DeficiencyRepository {
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

  async withTx<T>(ctx: RequestContext, fn: (tx: DeficiencyTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp019Error('SF-TEN-001');
    if (this.active) throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NESTED_TX' }] });
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

class MemoryTx implements DeficiencyTx {
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
    if (existing.fingerprint !== p.fingerprint) throw new Cmp019Error('SF-APP-002');
    if (existing.response) return Promise.resolve(existing.response);
    throw new Cmp019Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const k = this.idemKey(p);
    const row = this.d.idempotency.get(k);
    if (row) row.response = { status: p.status, body: p.body };
    return Promise.resolve();
  }

  insertNotice(row: NoticeRow): Promise<void> {
    for (const n of this.d.notices.values()) {
      if (
        n.application_id === row.application_id &&
        (n.status === 'OPEN' || n.status === 'RESPONSE_RECEIVED')
      ) {
        throw new Cmp019Error('SF-APP-002');
      }
    }
    this.d.notices.set(row.deficiency_id, { ...row });
    return Promise.resolve();
  }

  updateNotice(row: NoticeRow): Promise<void> {
    this.d.notices.set(row.deficiency_id, { ...row });
    return Promise.resolve();
  }

  getNotice(id: string): Promise<NoticeRow | undefined> {
    const row = this.d.notices.get(id);
    return Promise.resolve(row ? { ...row } : undefined);
  }

  findActiveByApplication(applicationId: string): Promise<NoticeRow | undefined> {
    for (const n of this.d.notices.values()) {
      if (
        n.application_id === applicationId &&
        (n.status === 'OPEN' || n.status === 'RESPONSE_RECEIVED')
      ) {
        return Promise.resolve({ ...n });
      }
    }
    return Promise.resolve(undefined);
  }

  listByApplication(applicationId: string): Promise<NoticeRow[]> {
    return Promise.resolve(
      [...this.d.notices.values()]
        .filter((n) => n.application_id === applicationId)
        .map((n) => ({ ...n })),
    );
  }

  insertItem(row: ItemRow): Promise<void> {
    this.d.items.push({ ...row });
    return Promise.resolve();
  }

  markItemsProvided(deficiencyId: string, codes: string[]): Promise<void> {
    const set = new Set(codes);
    for (const item of this.d.items) {
      if (item.deficiency_id === deficiencyId && set.has(item.item_code))
        item.item_status = 'PROVIDED';
    }
    return Promise.resolve();
  }

  listItems(deficiencyId: string): Promise<ItemRow[]> {
    return Promise.resolve(
      this.d.items.filter((i) => i.deficiency_id === deficiencyId).map((i) => ({ ...i })),
    );
  }

  insertResponse(row: ResponseRow): Promise<void> {
    this.d.responses.set(row.deficiency_id, { ...row });
    return Promise.resolve();
  }

  getResponse(deficiencyId: string): Promise<ResponseRow | undefined> {
    const row = this.d.responses.get(deficiencyId);
    return Promise.resolve(row ? { ...row } : undefined);
  }

  insertEvidence(row: EvidenceRow): Promise<void> {
    this.d.evidence.push({ ...row });
    return Promise.resolve();
  }

  listEvidence(deficiencyId: string): Promise<EvidenceRow[]> {
    return Promise.resolve(
      this.d.evidence.filter((e) => e.deficiency_id === deficiencyId).map((e) => ({ ...e })),
    );
  }

  appendHistory(row: HistoryRow): Promise<void> {
    this.d.history.push({ ...row });
    return Promise.resolve();
  }

  listHistory(deficiencyId: string): Promise<HistoryRow[]> {
    return Promise.resolve(this.d.history.filter((h) => h.deficiency_id === deficiencyId));
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.d.outbox.push({ topic, envelope });
    return Promise.resolve();
  }
}
