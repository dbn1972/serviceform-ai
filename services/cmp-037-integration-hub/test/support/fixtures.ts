import { randomUUID } from 'node:crypto';
import type { ConnectorBinding, RequestContext } from '@serviceform/contracts';
import type {
  ConnectorAdapter,
  InvokeContext,
  InvokeRequest,
  InvokeResult,
} from '@serviceform/connector-sdk';
import { isTransactionOpen } from '@serviceform/connector-sdk';
import { InMemorySecretResolver } from '../../../../packages/connector-sdk/test/support/in-memory-secrets.js';
import type { AuthorizationPort, DefinitionRecord } from '../../src/ports.js';
import { MemoryStore } from '../../src/memory.js';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const CANARY = `SFCANARY-${randomUUID()}`;

export function ctx(tenant = T1): RequestContext {
  return {
    tenant_id: tenant,
    cell_id: 'cell-01',
    actor: { type: 'OFFICER', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    roles: ['CONNECTOR_OPERATOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: randomUUID(),
    trace_id: 'ab'.repeat(16),
  };
}

export const allowAuth: AuthorizationPort = {
  async decide() {
    return {
      allow: true,
      reason_code: 'ALLOW',
      policy_revision: 'test',
      decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
  },
};

export function simulatedBinding(id = randomUUID()): ConnectorBinding & { enabled: boolean } {
  return {
    connector_binding_id: id,
    tenant_id: T1,
    connector_type: 'DEPARTMENT_API',
    mode: 'SIMULATED',
    environment: 'CI',
    critical: true,
    secret_ref: 'vault://sim/echo-webhook',
    simulator_version: 'echo-1.0.0',
    enabled: true,
  };
}

export function definition(adapter_key = 'echo'): DefinitionRecord {
  return {
    connector_definition_id: randomUUID(),
    adapter_key,
    connector_type: 'DEPARTMENT_API',
    supported_modes: ['SIMULATED'],
    timeout_ms: 1000,
    retry_policy: { timeoutMs: 50, maxAttempts: 3, baseMs: 1, factor: 2, maxMs: 5 },
    egress_allowlist: ['example.test'],
    status: 'ACTIVE',
  };
}

export class RecordingAdapter implements ConnectorAdapter {
  readonly connectorType = 'DEPARTMENT_API' as const;
  readonly supportedModes = ['SIMULATED', 'REAL'] as const;
  calls = 0;
  txnOpenAtCall: boolean[] = [];
  outcome: InvokeResult['outcome'] = 'ok';
  failUntil = 0;

  async invoke(_req: InvokeRequest, ctx: InvokeContext): Promise<InvokeResult> {
    this.calls += 1;
    this.txnOpenAtCall.push(isTransactionOpen());
    const simulation = ctx.simulation
      ? {
          simulation: true as const,
          scenario: ctx.simulation.scenario,
          test_run_id: ctx.simulation.test_run_id,
          connector_binding_id: ctx.binding.connector_binding_id,
          environment: 'CI' as const,
        }
      : undefined;
    if (this.calls <= this.failUntil) {
      return simulation
        ? { outcome: 'retryable_error', error_code: 'PROVIDER_UNAVAILABLE', simulation }
        : { outcome: 'retryable_error', error_code: 'PROVIDER_UNAVAILABLE' };
    }
    if (this.outcome === 'timeout') {
      return simulation ? { outcome: 'timeout', simulation } : { outcome: 'timeout' };
    }
    if (this.outcome === 'ok') {
      return simulation
        ? { outcome: 'ok', provider_reference: 'prov-1', response_ref: 'ref-1', simulation }
        : { outcome: 'ok', provider_reference: 'prov-1', response_ref: 'ref-1' };
    }
    return simulation
      ? { outcome: this.outcome, error_code: 'PROVIDER_UNAVAILABLE', simulation }
      : { outcome: this.outcome, error_code: 'PROVIDER_UNAVAILABLE' };
  }

  async verifyWebhook() {
    return { provider_reference: 'prov-1', outcome: 'ok' as const };
  }

  async health() {
    return { healthy: true };
  }
}

export function seededStore(binding = simulatedBinding(), adapterKey = 'echo') {
  const store = new MemoryStore();
  const def = definition(adapterKey);
  const record = { binding, definition: def };
  void store.insertDefinition(def);
  void store.insertBinding(record);
  const secrets = new InMemorySecretResolver();
  secrets.put('vault://sim/echo-webhook', CANARY);
  return { store, def, binding, secrets };
}
