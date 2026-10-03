import { randomUUID } from 'node:crypto';
import type { Pool, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { buildConnectorEnvelope } from '@serviceform/connector-sdk';
import { createPgHub } from '../src/pg.js';
import { ctx, definition, simulatedBinding } from './support/fixtures.js';
import type { TransactionRow } from '../src/ports.js';

function result(rows: unknown[] = [], rowCount = rows.length): QueryResult {
  return { rows, rowCount, command: 'SELECT', oid: 0, fields: [] } as QueryResult;
}

function mockPool(onQuery: (sql: string, params: unknown[]) => QueryResult): Pool {
  const run = async (sql: string, params: unknown[] = []) => onQuery(sql, params);
  const client = {
    query: run,
    release() {},
  };
  return {
    connect: async () => client,
    query: run,
  } as unknown as Pool;
}

function txRow(over: Partial<TransactionRow> = {}): TransactionRow {
  const binding = simulatedBinding();
  return {
    connector_transaction_id: randomUUID(),
    tenant_id: binding.tenant_id ?? '11111111-1111-4111-8111-111111111111',
    connector_binding_id: binding.connector_binding_id,
    direction: 'INVOKE',
    operation: 'ping',
    idempotency_key: 'k1',
    request_fingerprint: 'fp',
    provider_reference: null,
    status: 'IN_PROGRESS',
    attempts: 0,
    error_code: null,
    response_ref: null,
    mode: 'SIMULATED',
    environment: 'CI',
    simulation: { simulation: true },
    correlation_id: randomUUID(),
    aggregate_version: 1,
    ...over,
  };
}

describe('createPgHub', () => {
  it('runs domain DML, maps optional columns, duplicates, rollback and miss paths', async () => {
    const binding = simulatedBinding();
    const def = definition();
    const tenant = binding.tenant_id ?? '11111111-1111-4111-8111-111111111111';
    let invokeInserts = 0;
    let webhookInserts = 0;
    let inboxInserts = 0;
    let failNextBegin = false;
    const pool = mockPool((sql, params) => {
      if (failNextBegin && sql === 'BEGIN') {
        failNextBegin = false;
        throw new Error('begin_failed');
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('set_config')) {
        return result();
      }
      if (sql.includes('INSERT INTO sf_integration_hub.connector_definition')) return result();
      if (sql.includes('INSERT INTO sf_integration_hub.connector_binding ')) return result();
      if (sql.includes('INSERT INTO sf_integration_hub.webhook_route')) return result();
      if (sql.includes('INSERT INTO sf_integration_hub.connector_binding_index')) return result();
      if (sql.includes('FROM sf_integration_hub.connector_binding b')) {
        if (params[0] === 'missing') return result();
        return result([
          {
            connector_binding_id: binding.connector_binding_id,
            tenant_id: tenant,
            service_id: randomUUID(),
            connector_type: 'DEPARTMENT_API',
            mode: 'SIMULATED',
            environment: 'CI',
            critical: true,
            secret_ref: 'vault://sim/echo-webhook',
            simulator_version: 'echo-1.0.0',
            enabled: true,
            adapter_key: 'echo',
            supported_modes: ['SIMULATED'],
            timeout_ms: 1000,
            retry_policy: null,
            egress_allowlist: ['example.test'],
            def_status: 'ACTIVE',
            connector_definition_id: def.connector_definition_id,
          },
        ]);
      }
      if (sql.includes('FROM sf_integration_hub.connector_binding_index')) {
        return result([
          {
            binding_id: binding.connector_binding_id,
            tenant_id: tenant,
            environment: 'CI',
            mode: 'SIMULATED',
            critical: true,
            enabled: true,
            connector_type: 'DEPARTMENT_API',
            secret_ref: 'vault://sim/echo-webhook',
            simulator_version: 'echo-1.0.0',
            service_id: randomUUID(),
          },
        ]);
      }
      if (sql.includes('FROM sf_integration_hub.webhook_route')) {
        if (params[0] === 'missing') return result();
        return result([{ tenant_id: tenant }]);
      }
      if (sql.includes('INSERT INTO sf_integration_hub.connector_transaction')) {
        if (sql.includes("direction = 'WEBHOOK'")) {
          webhookInserts += 1;
          if (webhookInserts === 1) {
            return result([txRow({ direction: 'WEBHOOK', provider_reference: 'cb-1' })], 1);
          }
          return result([], 0);
        }
        invokeInserts += 1;
        if (invokeInserts === 1) return result([txRow()], 1);
        return result([], 0);
      }
      if (sql.includes("direction = 'INVOKE' AND idempotency_key")) {
        return result([txRow({ connector_transaction_id: 'existing-invoke' })]);
      }
      if (sql.includes("direction = 'WEBHOOK' AND provider_reference")) {
        return result([
          txRow({ connector_transaction_id: 'existing-webhook', direction: 'WEBHOOK' }),
        ]);
      }
      if (sql.includes('UPDATE sf_integration_hub.connector_transaction')) {
        return result([], params[0] === 'missing' ? 0 : 1);
      }
      if (
        sql.includes('FROM sf_integration_hub.connector_transaction WHERE connector_transaction_id')
      ) {
        if (params[0] === 'missing') return result();
        return result([txRow({ connector_transaction_id: String(params[0]) })]);
      }
      if (sql.includes('INSERT INTO sf_integration_hub.outbox_event')) return result();
      if (sql.includes('INSERT INTO sf_integration_hub.inbox_event')) {
        inboxInserts += 1;
        return result([], inboxInserts === 1 ? 1 : 0);
      }
      return result();
    });

    const hub = createPgHub(pool);
    const request = ctx();
    await hub.uow.withTransaction(request, async () => {
      await hub.bindings.insertDefinition(def);
      await hub.bindings.insertBinding({ binding, definition: def });
      const loaded = await hub.bindings.getById(binding.connector_binding_id);
      expect(loaded?.definition.adapter_key).toBe('echo');
      expect(loaded?.binding.service_id).toBeTruthy();
      expect(await hub.bindings.getById('missing')).toBeNull();
      expect(await hub.bindings.resolveWebhookTenant(binding.connector_binding_id)).toBe(tenant);
      expect(await hub.bindings.resolveWebhookTenant('missing')).toBeNull();
      const first = await hub.transactions.insertInvoke(txRow());
      expect(first.inserted).toBe(true);
      const dup = await hub.transactions.insertInvoke(txRow());
      expect(dup.inserted).toBe(false);
      expect(dup.row.connector_transaction_id).toBe('existing-invoke');
      const hook = await hub.transactions.insertWebhook(
        txRow({ direction: 'WEBHOOK', provider_reference: 'cb-1', idempotency_key: null }),
      );
      expect(hook.inserted).toBe(true);
      const hookDup = await hub.transactions.insertWebhook(
        txRow({ direction: 'WEBHOOK', provider_reference: 'cb-1', idempotency_key: null }),
      );
      expect(hookDup.inserted).toBe(false);
      expect(
        await hub.transactions.finalize(first.row.connector_transaction_id, {
          status: 'SUCCEEDED',
          attempts: 1,
          error_code: null,
          response_ref: 'r',
          provider_reference: 'p',
          simulation: { simulation: true },
          aggregate_version: 2,
        }),
      ).toBe(true);
      expect(
        await hub.transactions.finalize('missing', {
          status: 'FAILED',
          attempts: 1,
          error_code: 'X',
          response_ref: null,
          provider_reference: null,
          simulation: null,
          aggregate_version: 2,
        }),
      ).toBe(false);
      expect(
        await hub.transactions.getTransaction(first.row.connector_transaction_id),
      ).toBeTruthy();
      expect(await hub.transactions.getTransaction('missing')).toBeNull();
      await hub.outbox.insertTenant({
        topic: 'sf.integration-hub.events.v1',
        partition_key: first.row.connector_transaction_id,
        envelope: buildConnectorEnvelope({
          event_id: randomUUID(),
          event_type: 'ConnectorInvocationStarted',
          tenant_id: tenant,
          cell_id: 'cell-01',
          aggregate_id: first.row.connector_transaction_id,
          aggregate_version: 1,
          occurred_at: '2026-10-03T00:00:00.000Z',
          correlation_id: request.correlation_id,
          actor: request.actor,
          data: {
            connector_binding_id: binding.connector_binding_id,
            connector_type: 'DEPARTMENT_API',
            direction: 'INVOKE',
            mode: 'SIMULATED',
            attempts: 0,
          },
        }),
      });
      expect(await hub.inbox.record('cmp-037.webhook', randomUUID(), tenant)).toBe(true);
      expect(await hub.inbox.record('cmp-037.webhook', randomUUID(), tenant)).toBe(false);
    });
    const index = await hub.bindings.listEnabledIndex();
    expect(index).toHaveLength(1);
    expect(index[0]?.simulator_version).toBe('echo-1.0.0');

    await expect(
      hub.uow.withTransaction(request, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    failNextBegin = true;
    await expect(hub.uow.withTransaction(request, async () => 'x')).rejects.toThrow('begin_failed');
  });
});
