import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp020Error } from '../../src/errors.js';
import type {
  FeeRepository,
  FeeTx,
  IdempotencyPeek,
  LineRow,
  QuoteRow,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, RequestContext } from '../../src/types.js';

interface IdemRow extends IdempotencyPeek {
  key: string;
}

export interface TenantState {
  quotes: Map<string, QuoteRow>;
  lines: Map<string, LineRow[]>;
  idempotency: Map<string, IdemRow>;
  outbox: { topic: string; envelope: EventEnvelope<Record<string, unknown>> }[];
}

function emptyTenant(): TenantState {
  return { quotes: new Map(), lines: new Map(), idempotency: new Map(), outbox: [] };
}

function cloneTenant(s: TenantState): TenantState {
  return {
    quotes: new Map([...s.quotes].map(([k, v]) => [k, { ...v }])),
    lines: new Map([...s.lines].map(([k, v]) => [k, v.map((l) => ({ ...l }))])),
    idempotency: new Map([...s.idempotency].map(([k, v]) => [k, { ...v }])),
    outbox: [...s.outbox],
  };
}

const idemKey = (p: { principalId: string; endpoint: string; key: string }): string =>
  `${p.principalId}|${p.endpoint}|${p.key}`;

class MemoryTx implements FeeTx {
  constructor(private readonly s: TenantState) {}

  peekIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
  }): Promise<IdempotencyPeek | undefined> {
    const row = this.s.idempotency.get(idemKey(p));
    return Promise.resolve(row ? { ...row } : undefined);
  }

  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
  }): Promise<StoredIdempotent | 'claimed'> {
    const k = idemKey(p);
    const row = this.s.idempotency.get(k);
    if (!row) {
      this.s.idempotency.set(k, {
        key: p.key,
        request_fingerprint: p.fingerprint,
        status: 'IN_PROGRESS',
        response_status: null,
        response_body: null,
      });
      return Promise.resolve('claimed');
    }
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp020Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return Promise.resolve({ status: row.response_status, body: row.response_body });
    }
    throw new Cmp020Error('SF-APP-002');
  }

  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void> {
    const row = this.s.idempotency.get(idemKey(p));
    if (row) {
      row.status = 'COMPLETED';
      row.response_status = p.status;
      row.response_body = JSON.parse(JSON.stringify(p.body)) as unknown;
    }
    return Promise.resolve();
  }

  insertQuote(row: QuoteRow): Promise<boolean> {
    for (const q of this.s.quotes.values()) {
      if (q.application_id === row.application_id && q.calculation_hash === row.calculation_hash) {
        return Promise.resolve(false);
      }
    }
    if (this.s.quotes.has(row.quote_id)) throw Object.assign(new Error('dup'), { code: '23505' });
    this.s.quotes.set(row.quote_id, { ...row });
    return Promise.resolve(true);
  }

  insertLine(row: LineRow): Promise<void> {
    const list = this.s.lines.get(row.quote_id) ?? [];
    if (list.some((l) => l.code === row.code || l.line_seq === row.line_seq)) {
      throw Object.assign(new Error('dup'), { code: '23505' });
    }
    list.push({ ...row });
    this.s.lines.set(row.quote_id, list);
    return Promise.resolve();
  }

  getQuote(quoteId: string): Promise<QuoteRow | undefined> {
    const q = this.s.quotes.get(quoteId);
    return Promise.resolve(q ? { ...q } : undefined);
  }

  findQuoteByCalculation(
    applicationId: string,
    calculationHash: string,
  ): Promise<QuoteRow | undefined> {
    for (const q of this.s.quotes.values()) {
      if (q.application_id === applicationId && q.calculation_hash === calculationHash) {
        return Promise.resolve({ ...q });
      }
    }
    return Promise.resolve(undefined);
  }

  listLines(quoteId: string): Promise<LineRow[]> {
    return Promise.resolve(
      [...(this.s.lines.get(quoteId) ?? [])].sort((a, b) => a.line_seq - b.line_seq),
    );
  }

  listByApplication(applicationId: string): Promise<QuoteRow[]> {
    return Promise.resolve(
      [...this.s.quotes.values()]
        .filter((q) => q.application_id === applicationId)
        .sort(
          (a, b) => a.issued_at.localeCompare(b.issued_at) || a.quote_id.localeCompare(b.quote_id),
        ),
    );
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({
      topic,
      envelope: JSON.parse(JSON.stringify(envelope)) as EventEnvelope<Record<string, unknown>>,
    });
    return Promise.resolve();
  }
}

/** Tenant-partitioned store with all-or-nothing transactions, mirroring RLS + COMMIT/ROLLBACK. */
export class MemoryFeeRepository implements FeeRepository {
  private readonly als = new AsyncLocalStorage<true>();
  private readonly tenants = new Map<string, TenantState>();
  txCount = 0;

  tenant(id: string): TenantState {
    let s = this.tenants.get(id);
    if (!s) {
      s = emptyTenant();
      this.tenants.set(id, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this.als.getStore() === true;
  }

  async withTx<T>(ctx: RequestContext, fn: (tx: FeeTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp020Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp020Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    this.txCount += 1;
    const live = this.tenant(ctx.tenant_id);
    const work = cloneTenant(live);
    const result = await this.als.run(true, () => fn(new MemoryTx(work)));
    this.tenants.set(ctx.tenant_id, work);
    return result;
  }
}
