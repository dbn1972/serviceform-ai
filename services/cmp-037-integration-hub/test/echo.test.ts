import { describe, expect, it } from 'vitest';
import { EchoSimulatorAdapter } from '../../../simulators/framework/src/index.js';
import { buildSimulationMarker } from '../../../simulators/framework/src/marker.js';
import type { ConnectorBinding } from '@serviceform/contracts';

const local: ConnectorBinding = {
  connector_binding_id: 'd17e5fc0-28e4-4b6a-b9d1-04cfa0e28d5d',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  connector_type: 'DEPARTMENT_API',
  mode: 'SIMULATED',
  environment: 'LOCAL',
  critical: true,
  secret_ref: null,
  simulator_version: 'echo-1.0.0',
};

describe('echo simulator', () => {
  it('is deterministic and refuses production-class environments', async () => {
    const adapter = new EchoSimulatorAdapter();
    const ctx = {
      binding: local,
      secrets: { resolve: async () => ({ reveal: () => 'x', toString: () => '[REDACTED]' }) },
      signal: AbortSignal.timeout(1000),
      correlation_id: '11111111-1111-4111-8111-111111111111',
      attempt: 1,
      simulation: { scenario: 'success' as const, test_run_id: 'run-a' },
      guardedFetch: async () => new Response(),
    };
    const a = await adapter.invoke(
      { operation: 'x', payload: {}, request_fingerprint: 'abc' },
      ctx as never,
    );
    const b = await adapter.invoke(
      { operation: 'x', payload: {}, request_fingerprint: 'abc' },
      ctx as never,
    );
    expect(a.provider_reference).toBe(b.provider_reference);
    expect(a.simulation?.simulation).toBe(true);
    expect(() =>
      buildSimulationMarker(
        { ...local, environment: 'PRODUCTION' },
        { scenario: 'success', test_run_id: 'run-a' },
      ),
    ).toThrow(/environment/);
  });

  it('covers timeout, permanent, transient, malformed and REAL-mode refusal', async () => {
    const adapter = new EchoSimulatorAdapter();
    const base = {
      binding: local,
      secrets: { resolve: async () => ({ reveal: () => 'x', toString: () => '[REDACTED]' }) },
      signal: AbortSignal.timeout(1000),
      correlation_id: '11111111-1111-4111-8111-111111111111',
      guardedFetch: async () => new Response(),
    };
    const req = { operation: 'x', payload: {}, request_fingerprint: 'abc' };
    const timeout = await adapter.invoke(req, {
      ...base,
      attempt: 1,
      simulation: { scenario: 'timeout', test_run_id: 'run-a' },
    } as never);
    expect(timeout.outcome).toBe('timeout');
    const perm = await adapter.invoke(req, {
      ...base,
      attempt: 1,
      simulation: { scenario: 'fail_permanent', test_run_id: 'run-a' },
    } as never);
    expect(perm.outcome).toBe('permanent_error');
    const transient = await adapter.invoke(req, {
      ...base,
      attempt: 1,
      simulation: { scenario: 'fail_transient_then_success', test_run_id: 'run-a' },
    } as never);
    expect(transient.outcome).toBe('retryable_error');
    const recovered = await adapter.invoke(req, {
      ...base,
      attempt: 2,
      simulation: { scenario: 'fail_transient_then_success', test_run_id: 'run-a' },
    } as never);
    expect(recovered.outcome).toBe('ok');
    const malformed = await adapter.invoke(req, {
      ...base,
      attempt: 1,
      simulation: { scenario: 'malformed_response', test_run_id: 'run-a' },
    } as never);
    expect(malformed.outcome).toBe('permanent_error');
    const real = await adapter.invoke(req, {
      ...base,
      attempt: 1,
      binding: { ...local, mode: 'REAL', environment: 'PRODUCTION', secret_ref: 'vault://x' },
      simulation: { scenario: 'success', test_run_id: 'run-a' },
    } as never);
    expect(real.outcome).toBe('permanent_error');
    const health = await adapter.health({ binding: local, signal: AbortSignal.timeout(10) });
    expect(health.healthy).toBe(true);
  });
});
