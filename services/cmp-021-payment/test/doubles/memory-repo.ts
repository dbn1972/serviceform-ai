import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp021Error } from '../../src/errors.js';
import type {
  CallbackRow,
  IdempotencyPeek,
  IntentRow,
  PaymentRepository,
  PaymentTx,
  StoredIdempotent,
} from '../../src/repo/types.js';
import type { EventEnvelope, PaymentStatus, RequestContext } from '../../src/types.js';

interface IdemRow extends IdempotencyPeek {
  key: string;
}

export interface TenantState {
  intents: Map<string, IntentRow>;
  callbacks: Map<string, CallbackRow>;
  callbacksByExactlyOnceKey: Map<string, string>;
  exactlyOnceEffects: Set<string>;
  idempotency: Map<string, IdemRow>;
  outbox: { topic: string; envelope: EventEnvelope<Record<string, unknown>> }[];
}

function emptyTenant(): TenantState {
  return {
    intents: new Map(),
    callbacks: new Map(),
    callbacksByExactlyOnceKey: new Map(),
    exactlyOnceEffects: new Set(),
    idempotency: new Map(),
    outbox: [],
  };
}

function cloneTenant(s: TenantState): TenantState {
  return {
    intents: new Map([...s.intents].map(([k, v]) => [k, { ...v }])),
    callbacks: new Map([...s.callbacks].map(([k, v]) => [k, { ...v }])),
    callbacksByExactlyOnceKey: new Map(s.callbacksByExactlyOnceKey),
    exactlyOnceEffects: new Set(s.exactlyOnceEffects),
    idempotency: new Map([...s.idempotency].map(([k, v]) => [k, { ...v }])),
    outbox: [...s.outbox],
  };
}

const idemKey = (p: { principalId: string; endpoint: string; key: string }): string =>
  `${p.principalId}|${p.endpoint}|${p.key}`;

class MemoryTx implements PaymentTx {
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
    now: Date;
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
    if (row.request_fingerprint !== p.fingerprint) throw new Cmp021Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response_status !== null) {
      return Promise.resolve({ status: row.response_status, body: row.response_body });
    }
    throw new Cmp021Error('SF-APP-002');
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

  insertIntent(row: IntentRow): Promise<boolean> {
    if (this.s.intents.has(row.payment_intent_id)) {
      throw Object.assign(new Error('dup'), { code: '23505' });
    }
    this.s.intents.set(row.payment_intent_id, { ...row });
    return Promise.resolve(true);
  }

  getIntent(paymentIntentId: string): Promise<IntentRow | undefined> {
    const r = this.s.intents.get(paymentIntentId);
    return Promise.resolve(r ? { ...r } : undefined);
  }

  updateIntentStatus(paymentIntentId: string, status: PaymentStatus): Promise<void> {
    const r = this.s.intents.get(paymentIntentId);
    if (r) r.status = status;
    return Promise.resolve();
  }

  insertCallback(row: CallbackRow): Promise<void> {
    this.s.callbacks.set(row.callback_id, { ...row });
    this.s.callbacksByExactlyOnceKey.set(row.exactly_once_key, row.callback_id);
    return Promise.resolve();
  }

  getCallbackByExactlyOnceKey(exactlyOnceKey: string): Promise<CallbackRow | undefined> {
    const id = this.s.callbacksByExactlyOnceKey.get(exactlyOnceKey);
    if (!id) return Promise.resolve(undefined);
    const row = this.s.callbacks.get(id);
    return Promise.resolve(row ? { ...row } : undefined);
  }

  claimExactlyOnceEffect(
    _tenantId: string,
    exactlyOnceKey: string,
    _callbackId: string,
  ): Promise<boolean> {
    if (this.s.exactlyOnceEffects.has(exactlyOnceKey)) return Promise.resolve(false);
    this.s.exactlyOnceEffects.add(exactlyOnceKey);
    return Promise.resolve(true);
  }

  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    this.s.outbox.push({
      topic,
      envelope: JSON.parse(JSON.stringify(envelope)) as EventEnvelope<Record<string, unknown>>,
    });
    return Promise.resolve();
  }
}

export class MemoryPaymentRepository implements PaymentRepository {
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

  async withTx<T>(ctx: RequestContext, fn: (tx: PaymentTx) => Promise<T>): Promise<T> {
    if (ctx.tenant_id === null) throw new Cmp021Error('SF-TEN-001');
    if (this.inTransaction()) {
      throw new Cmp021Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    this.txCount += 1;
    const live = this.tenant(ctx.tenant_id);
    const work = cloneTenant(live);
    const result = await this.als.run(true, () => fn(new MemoryTx(work)));
    this.tenants.set(ctx.tenant_id, work);
    return result;
  }
}
