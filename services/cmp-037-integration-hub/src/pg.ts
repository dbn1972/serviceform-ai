import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type { ConnectorBinding, RequestContext } from '@serviceform/contracts';
import { dbSessionSettings } from '@serviceform/contracts';
import {
  runInTransaction,
  type EnabledBinding,
  type RetryPolicy,
} from '@serviceform/connector-sdk';
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

type Q = (sql: string, params?: unknown[]) => Promise<QueryResult>;

export function createPgHub(pool: Pool): {
  uow: UnitOfWork;
  bindings: BindingRepository;
  transactions: TransactionRepository;
  outbox: OutboxWriter;
  inbox: InboxWriter;
} {
  const als = new AsyncLocalStorage<PoolClient>();
  const q: Q = (sql, params) => {
    const client = als.getStore();
    return client ? client.query(sql, params) : pool.query(sql, params);
  };
  const uow: UnitOfWork = {
    async withTransaction<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const settings = dbSessionSettings(ctx);
        for (const [key, value] of Object.entries(settings)) {
          await client.query('SELECT set_config($1, $2, true)', [key, value]);
        }
        const result = await als.run(client, () => runInTransaction(fn));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return {
    uow,
    bindings: new PgBindings(q),
    transactions: new PgTransactions(q),
    outbox: new PgOutbox(q),
    inbox: new PgInbox(q),
  };
}

class PgBindings implements BindingRepository {
  constructor(private readonly q: Q) {}

  async insertDefinition(def: DefinitionRecord): Promise<void> {
    await this.q(
      `INSERT INTO sf_integration_hub.connector_definition (
         connector_definition_id, connector_type, adapter_key, display_name, supported_modes,
         retry_policy, timeout_ms, egress_allowlist, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        def.connector_definition_id,
        def.connector_type,
        def.adapter_key,
        def.adapter_key,
        def.supported_modes,
        def.retry_policy ? JSON.stringify(def.retry_policy) : null,
        def.timeout_ms,
        def.egress_allowlist,
        def.status,
      ],
    );
  }

  async insertBinding(record: BindingRecord): Promise<void> {
    const b = record.binding;
    await this.q(
      `INSERT INTO sf_integration_hub.connector_binding (
         connector_binding_id, tenant_id, service_id, connector_definition_id, connector_type,
         mode, environment, critical, secret_ref, simulator_version, enabled
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        b.connector_binding_id,
        b.tenant_id,
        b.service_id ?? null,
        record.definition.connector_definition_id,
        b.connector_type,
        b.mode,
        b.environment,
        b.critical,
        b.secret_ref,
        b.simulator_version ?? null,
        b.enabled,
      ],
    );
    await this.q(
      `INSERT INTO sf_integration_hub.webhook_route (binding_id, tenant_id) VALUES ($1,$2)`,
      [b.connector_binding_id, b.tenant_id],
    );
    await this.q(
      `INSERT INTO sf_integration_hub.connector_binding_index
         (binding_id, tenant_id, environment, mode, critical, enabled, connector_type, secret_ref, simulator_version, service_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        b.connector_binding_id,
        b.tenant_id,
        b.environment,
        b.mode,
        b.critical,
        b.enabled,
        b.connector_type,
        b.secret_ref,
        b.simulator_version ?? null,
        b.service_id ?? null,
      ],
    );
  }

  async getById(id: string): Promise<BindingRecord | null> {
    const res = await this.q(
      `SELECT b.*, d.adapter_key, d.supported_modes, d.timeout_ms, d.retry_policy, d.egress_allowlist,
              d.status AS def_status, d.connector_definition_id
         FROM sf_integration_hub.connector_binding b
         JOIN sf_integration_hub.connector_definition d ON d.connector_definition_id = b.connector_definition_id
        WHERE b.connector_binding_id = $1`,
      [id],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? mapBinding(row) : null;
  }

  async listEnabledIndex(): Promise<EnabledBinding[]> {
    const res = await this.q(
      `SELECT binding_id, tenant_id, environment, mode, critical, enabled, connector_type, secret_ref, simulator_version, service_id
         FROM sf_integration_hub.connector_binding_index`,
    );
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      const out: EnabledBinding = {
        connector_binding_id: String(row['binding_id']),
        tenant_id: String(row['tenant_id']),
        connector_type: row['connector_type'] as ConnectorBinding['connector_type'],
        mode: row['mode'] as ConnectorBinding['mode'],
        environment: row['environment'] as ConnectorBinding['environment'],
        critical: Boolean(row['critical']),
        secret_ref: (row['secret_ref'] as string | null) ?? null,
        enabled: Boolean(row['enabled']),
      };
      if (row['simulator_version']) out.simulator_version = String(row['simulator_version']);
      if (row['service_id']) out.service_id = String(row['service_id']);
      return out;
    });
  }

  async resolveWebhookTenant(bindingId: string): Promise<string | null> {
    const res = await this.q(
      `SELECT tenant_id FROM sf_integration_hub.webhook_route WHERE binding_id = $1`,
      [bindingId],
    );
    const row = res.rows[0] as { tenant_id?: string } | undefined;
    return row?.tenant_id ?? null;
  }
}

class PgTransactions implements TransactionRepository {
  constructor(private readonly q: Q) {}

  async insertInvoke(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }> {
    const res = await this.q(
      `INSERT INTO sf_integration_hub.connector_transaction (
         connector_transaction_id, tenant_id, connector_binding_id, direction, operation,
         idempotency_key, request_fingerprint, provider_reference, status, attempts, error_code,
         response_ref, mode, environment, simulation, correlation_id, aggregate_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tenant_id, connector_binding_id, direction, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING *`,
      bindTx(row),
    );
    if ((res.rowCount ?? 0) > 0)
      return { inserted: true, row: mapTx(res.rows[0] as Record<string, unknown>) };
    const existing = await this.q(
      `SELECT * FROM sf_integration_hub.connector_transaction
        WHERE tenant_id = $1 AND connector_binding_id = $2 AND direction = 'INVOKE' AND idempotency_key = $3`,
      [row.tenant_id, row.connector_binding_id, row.idempotency_key],
    );
    return { inserted: false, row: mapTx(existing.rows[0] as Record<string, unknown>) };
  }

  async insertWebhook(row: TransactionRow): Promise<{ inserted: boolean; row: TransactionRow }> {
    const res = await this.q(
      `INSERT INTO sf_integration_hub.connector_transaction (
         connector_transaction_id, tenant_id, connector_binding_id, direction, operation,
         idempotency_key, request_fingerprint, provider_reference, status, attempts, error_code,
         response_ref, mode, environment, simulation, correlation_id, aggregate_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tenant_id, connector_binding_id, provider_reference)
         WHERE direction = 'WEBHOOK' AND provider_reference IS NOT NULL
       DO NOTHING
       RETURNING *`,
      bindTx(row),
    );
    if ((res.rowCount ?? 0) > 0)
      return { inserted: true, row: mapTx(res.rows[0] as Record<string, unknown>) };
    const existing = await this.q(
      `SELECT * FROM sf_integration_hub.connector_transaction
        WHERE tenant_id = $1 AND connector_binding_id = $2 AND direction = 'WEBHOOK' AND provider_reference = $3`,
      [row.tenant_id, row.connector_binding_id, row.provider_reference],
    );
    return { inserted: false, row: mapTx(existing.rows[0] as Record<string, unknown>) };
  }

  async finalize(
    id: string,
    patch: Pick<
      TransactionRow,
      'status' | 'attempts' | 'error_code' | 'response_ref' | 'provider_reference' | 'simulation'
    > & {
      aggregate_version: number;
    },
  ): Promise<boolean> {
    const res = await this.q(
      `UPDATE sf_integration_hub.connector_transaction
          SET status = $2, attempts = $3, error_code = $4, response_ref = $5,
              provider_reference = $6, simulation = $7, aggregate_version = $8, completed_at = now()
        WHERE connector_transaction_id = $1 AND status IN ('PENDING', 'IN_PROGRESS')`,
      [
        id,
        patch.status,
        patch.attempts,
        patch.error_code,
        patch.response_ref,
        patch.provider_reference,
        patch.simulation ? JSON.stringify(patch.simulation) : null,
        patch.aggregate_version,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async getTransaction(id: string): Promise<TransactionRow | null> {
    const res = await this.q(
      `SELECT * FROM sf_integration_hub.connector_transaction WHERE connector_transaction_id = $1`,
      [id],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? mapTx(row) : null;
  }
}

class PgOutbox implements OutboxWriter {
  constructor(private readonly q: Q) {}

  async insertTenant(input: {
    envelope: unknown;
    topic: string;
    partition_key: string;
  }): Promise<void> {
    const envelope = input.envelope as {
      event_id: string;
      tenant_id: string;
      event_type: string;
      schema_version: number;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: number;
    };
    // replaced by packages/outbox at stitching
    await this.q(
      `INSERT INTO sf_integration_hub.outbox_event (
         event_id, tenant_id, topic, partition_key, event_type, schema_version,
         aggregate_type, aggregate_id, aggregate_version, envelope
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        envelope.event_id,
        envelope.tenant_id,
        input.topic,
        input.partition_key,
        envelope.event_type,
        envelope.schema_version,
        envelope.aggregate_type,
        envelope.aggregate_id,
        envelope.aggregate_version,
        JSON.stringify(input.envelope),
      ],
    );
  }
}

class PgInbox implements InboxWriter {
  constructor(private readonly q: Q) {}

  async record(consumerGroup: string, eventId: string, tenantId: string): Promise<boolean> {
    const res = await this.q(
      `INSERT INTO sf_integration_hub.inbox_event (consumer_group, event_id, tenant_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [consumerGroup, eventId, tenantId],
    );
    return (res.rowCount ?? 0) === 1;
  }
}

function bindTx(row: TransactionRow): unknown[] {
  return [
    row.connector_transaction_id,
    row.tenant_id,
    row.connector_binding_id,
    row.direction,
    row.operation,
    row.idempotency_key,
    row.request_fingerprint,
    row.provider_reference,
    row.status,
    row.attempts,
    row.error_code,
    row.response_ref,
    row.mode,
    row.environment,
    row.simulation ? JSON.stringify(row.simulation) : null,
    row.correlation_id,
    row.aggregate_version,
  ];
}

function mapTx(row: Record<string, unknown>): TransactionRow {
  return {
    connector_transaction_id: String(row['connector_transaction_id']),
    tenant_id: String(row['tenant_id']),
    connector_binding_id: String(row['connector_binding_id']),
    direction: row['direction'] as TransactionRow['direction'],
    operation: String(row['operation']),
    idempotency_key: (row['idempotency_key'] as string | null) ?? null,
    request_fingerprint: String(row['request_fingerprint']),
    provider_reference: (row['provider_reference'] as string | null) ?? null,
    status: row['status'] as TransactionRow['status'],
    attempts: Number(row['attempts']),
    error_code: (row['error_code'] as string | null) ?? null,
    response_ref: (row['response_ref'] as string | null) ?? null,
    mode: String(row['mode']),
    environment: String(row['environment']),
    simulation: row['simulation'] ?? null,
    correlation_id: String(row['correlation_id']),
    aggregate_version: Number(row['aggregate_version']),
  };
}

function mapBinding(row: Record<string, unknown>): BindingRecord {
  const binding: ConnectorBinding & { enabled: boolean } = {
    connector_binding_id: String(row['connector_binding_id']),
    tenant_id: String(row['tenant_id']),
    connector_type: row['connector_type'] as ConnectorBinding['connector_type'],
    mode: row['mode'] as ConnectorBinding['mode'],
    environment: row['environment'] as ConnectorBinding['environment'],
    critical: Boolean(row['critical']),
    secret_ref: (row['secret_ref'] as string | null) ?? null,
    enabled: Boolean(row['enabled']),
  };
  if (row['service_id']) binding.service_id = String(row['service_id']);
  if (row['simulator_version']) binding.simulator_version = String(row['simulator_version']);
  return {
    binding,
    definition: {
      connector_definition_id: String(row['connector_definition_id']),
      adapter_key: String(row['adapter_key']),
      connector_type: binding.connector_type,
      supported_modes: row['supported_modes'] as string[],
      timeout_ms: Number(row['timeout_ms']),
      retry_policy: (row['retry_policy'] as RetryPolicy | null) ?? null,
      egress_allowlist: (row['egress_allowlist'] as string[]) ?? [],
      status: row['def_status'] as DefinitionRecord['status'],
    },
  };
}
