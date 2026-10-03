import type { EnabledBinding } from '@serviceform/connector-sdk';
import type {
  BindingRecord,
  BindingRepository,
  DefinitionRecord,
  InboxWriter,
  OutboxWriter,
  TransactionRepository,
  TransactionRow,
  UnitOfWork,
} from './ports.js';
import type { RequestContext } from '@serviceform/contracts';
import { runInTransaction } from '@serviceform/connector-sdk';

export class MemoryStore
  implements BindingRepository, TransactionRepository, OutboxWriter, InboxWriter, UnitOfWork
{
  definitions = new Map<string, DefinitionRecord>();
  bindings = new Map<string, BindingRecord>();
  routes = new Map<string, string>();
  index: EnabledBinding[] = [];
  transactions = new Map<string, TransactionRow>();
  outbox: unknown[] = [];
  inbox = new Set<string>();

  async insertDefinition(def: DefinitionRecord): Promise<void> {
    this.definitions.set(def.connector_definition_id, def);
  }

  async insertBinding(record: BindingRecord): Promise<void> {
    this.bindings.set(record.binding.connector_binding_id, record);
    if (record.binding.tenant_id) {
      this.routes.set(record.binding.connector_binding_id, record.binding.tenant_id);
      this.index.push({ ...record.binding, enabled: record.binding.enabled });
    }
  }

  async getById(id: string): Promise<BindingRecord | null> {
    return this.bindings.get(id) ?? null;
  }

  async listEnabledIndex(): Promise<EnabledBinding[]> {
    return this.index.filter((b) => b.enabled);
  }

  async resolveWebhookTenant(bindingId: string): Promise<string | null> {
    return this.routes.get(bindingId) ?? null;
  }

  async insertInvoke(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }> {
    if (row.idempotency_key) {
      for (const existing of this.transactions.values()) {
        if (
          existing.tenant_id === row.tenant_id &&
          existing.connector_binding_id === row.connector_binding_id &&
          existing.direction === 'INVOKE' &&
          existing.idempotency_key === row.idempotency_key
        ) {
          return { inserted: false, row: existing };
        }
      }
    }
    this.transactions.set(row.connector_transaction_id, row);
    return { inserted: true, row };
  }

  async insertWebhook(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }> {
    for (const existing of this.transactions.values()) {
      if (
        existing.tenant_id === row.tenant_id &&
        existing.connector_binding_id === row.connector_binding_id &&
        existing.direction === 'WEBHOOK' &&
        existing.provider_reference === row.provider_reference
      ) {
        return { inserted: false, row: existing };
      }
    }
    this.transactions.set(row.connector_transaction_id, row);
    return { inserted: true, row };
  }

  async finalize(
    id: string,
    patch: Pick<
      TransactionRow,
      'status' | 'attempts' | 'error_code' | 'response_ref' | 'provider_reference' | 'simulation'
    > & { aggregate_version: number },
  ): Promise<boolean> {
    const row = this.transactions.get(id);
    if (!row || (row.status !== 'PENDING' && row.status !== 'IN_PROGRESS')) return false;
    this.transactions.set(id, { ...row, ...patch });
    return true;
  }

  async getTransaction(id: string): Promise<TransactionRow | null> {
    return this.transactions.get(id) ?? null;
  }

  async insertTenant(input: {
    envelope: unknown;
    topic: string;
    partition_key: string;
  }): Promise<void> {
    this.outbox.push(input);
  }

  async record(consumerGroup: string, eventId: string, tenantId: string): Promise<boolean> {
    const key = `${consumerGroup}:${eventId}:${tenantId}`;
    if (this.inbox.has(key)) return false;
    this.inbox.add(key);
    return true;
  }

  async withTransaction<T>(_ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
    return runInTransaction(fn);
  }
}
