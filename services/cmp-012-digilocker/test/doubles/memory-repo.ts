import { randomUUID } from 'node:crypto';
import type {
  DigilockerRepository,
  DigilockerTx,
  IdempotencyRecord,
  PublishRow,
} from '../../src/repo/types.js';
import type { TenantContext } from '../../src/types.js';

interface TenantStore {
  publishRecords: Map<string, PublishRow>;
  idempotency: Map<string, IdempotencyRecord>;
  outbox: Array<{ topic: string; envelope: Record<string, unknown> }>;
}

export class MemoryDigilockerRepository implements DigilockerRepository {
  private _inTx = false;
  readonly stores = new Map<string, TenantStore>();

  tenant(tenantId: string): TenantStore {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = {
        publishRecords: new Map(),
        idempotency: new Map(),
        outbox: [],
      };
      this.stores.set(tenantId, s);
    }
    return s;
  }

  inTransaction(): boolean {
    return this._inTx;
  }

  async withTx<T>(ctx: TenantContext, fn: (tx: DigilockerTx) => Promise<T>): Promise<T> {
    const store = this.tenant(ctx.tenant_id);
    this._inTx = true;
    try {
      const tx = this.makeTx(ctx.tenant_id, store);
      return await fn(tx);
    } finally {
      this._inTx = false;
    }
  }

  private makeTx(tenantId: string, store: TenantStore): DigilockerTx {
    return {
      async insertPublishRecord(row: PublishRow): Promise<void> {
        store.publishRecords.set(row.publish_request_id, { ...row });
      },

      async updatePublishRecord(
        _tenantId: string,
        publishRequestId: string,
        patch: Pick<
          PublishRow,
          'publish_status' | 'provider_transaction_ref' | 'failure_code' | 'attempt_number'
        >,
      ): Promise<boolean> {
        const row = store.publishRecords.get(publishRequestId);
        if (!row) return false;
        Object.assign(row, patch, { updated_at: new Date().toISOString() });
        return true;
      },

      async getPublishRecord(
        _tenantId: string,
        publishRequestId: string,
      ): Promise<PublishRow | null> {
        return store.publishRecords.get(publishRequestId) ?? null;
      },

      async insertOutbox(envelope: unknown, topic: string): Promise<void> {
        store.outbox.push({ topic, envelope: envelope as Record<string, unknown> });
      },

      async claimIdempotency(opts: {
        principalId: string;
        endpoint: string;
        key: string;
        fingerprint: string;
        now: Date;
      }): Promise<IdempotencyRecord | 'claimed'> {
        const k = `${opts.principalId}:${opts.endpoint}:${opts.key}`;
        const existing = store.idempotency.get(k);
        if (existing) return existing;
        const record: IdempotencyRecord = {
          tenant_id: tenantId,
          principal_id: opts.principalId,
          endpoint: opts.endpoint,
          idempotency_key: opts.key,
          request_fingerprint: opts.fingerprint,
          status: 'IN_PROGRESS',
          response_ref: null,
          response_status: null,
          response_body: null,
          created_at: opts.now.toISOString(),
          expires_at: new Date(opts.now.getTime() + 86400000).toISOString(),
        };
        store.idempotency.set(k, record);
        return 'claimed';
      },

      async peekIdempotency(opts: {
        principalId: string;
        endpoint: string;
        key: string;
      }): Promise<IdempotencyRecord | null> {
        const k = `${opts.principalId}:${opts.endpoint}:${opts.key}`;
        return store.idempotency.get(k) ?? null;
      },

      async completeIdempotency(opts: {
        principalId: string;
        endpoint: string;
        key: string;
        status: number;
        body: unknown;
      }): Promise<void> {
        const k = `${opts.principalId}:${opts.endpoint}:${opts.key}`;
        const record = store.idempotency.get(k);
        if (record) {
          record.status = 'COMPLETED';
          record.response_status = opts.status;
          record.response_body = opts.body;
        }
      },
    };
  }
}
