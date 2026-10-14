import { describe, expect, it } from 'vitest';
import {
  assertBindingPolicy,
  buildSimulationMarker,
  isSimulationMarker,
  type ConnectorBindingView,
} from '../../src/domain/simulation.js';
import { Cmp012Error } from '../../src/errors.js';
import { BINDING_ID, simulatedBinding } from '../doubles/fixtures.js';

describe('assertBindingPolicy (INT-013)', () => {
  it('accepts a valid SIMULATED DIGILOCKER binding in LOCAL', () => {
    const binding = simulatedBinding();
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'LOCAL' }),
    ).not.toThrow();
  });

  it('throws CONNECTOR_BINDING_NOT_FOUND when null', () => {
    expect(() =>
      assertBindingPolicy(null, { tenantId: 'any', runtimeEnvironment: 'LOCAL' }),
    ).toThrow(Cmp012Error);
  });

  it('throws CRITICAL_NON_REAL_IN_PRODUCTION for critical SIMULATED in PRODUCTION', () => {
    const binding = simulatedBinding({
      mode: 'SIMULATED',
      environment: 'PRODUCTION',
      critical: true,
    });
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'PRODUCTION' }),
    ).toThrow(Cmp012Error);
  });

  it('throws NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED for REAL in LOCAL', () => {
    const binding: ConnectorBindingView = {
      connector_binding_id: BINDING_ID,
      tenant_id: null,
      connector_type: 'DIGILOCKER',
      mode: 'REAL',
      environment: 'LOCAL',
      critical: false,
      secret_ref: 'aws-sm://prod/digilocker-key',
    };
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'LOCAL' }),
    ).toThrow(Cmp012Error);
  });

  it('throws CONNECTOR_TYPE_MISMATCH for non-DIGILOCKER connector', () => {
    const binding = simulatedBinding({ connector_type: 'PAYMENT' });
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'LOCAL' }),
    ).toThrow(Cmp012Error);
  });

  it('throws CONNECTOR_ENVIRONMENT_MISMATCH when env does not match runtime', () => {
    const binding = simulatedBinding({ environment: 'CI' });
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'LOCAL' }),
    ).toThrow(Cmp012Error);
  });

  it('accepts SANDBOX binding in DEVELOPMENT', () => {
    const binding: ConnectorBindingView = {
      connector_binding_id: BINDING_ID,
      tenant_id: null,
      connector_type: 'DIGILOCKER',
      mode: 'SANDBOX',
      environment: 'DEVELOPMENT',
      critical: false,
      secret_ref: 'aws-sm://dev/digilocker-sandbox',
    };
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'DEVELOPMENT' }),
    ).not.toThrow();
  });

  it('accepts REAL binding in PRODUCTION (non-critical)', () => {
    const binding: ConnectorBindingView = {
      connector_binding_id: BINDING_ID,
      tenant_id: null,
      connector_type: 'DIGILOCKER',
      mode: 'REAL',
      environment: 'PRODUCTION',
      critical: true,
      secret_ref: 'aws-sm://prod/digilocker',
    };
    expect(() =>
      assertBindingPolicy(binding, { tenantId: 'any', runtimeEnvironment: 'PRODUCTION' }),
    ).not.toThrow();
  });
});

describe('buildSimulationMarker', () => {
  it('builds a valid marker for SIMULATED binding', () => {
    const binding = simulatedBinding();
    const marker = buildSimulationMarker(binding, 'run-xyz');
    expect(marker).not.toBeNull();
    expect(marker?.simulation).toBe(true);
    expect(marker?.scenario).toBe('digilocker_publish');
    expect(marker?.test_run_id).toBe('run-xyz');
    expect(marker?.connector_binding_id).toBe(BINDING_ID);
  });

  it('returns null for non-SIMULATED mode', () => {
    const binding: ConnectorBindingView = {
      connector_binding_id: BINDING_ID,
      tenant_id: null,
      connector_type: 'DIGILOCKER',
      mode: 'SANDBOX',
      environment: 'DEVELOPMENT',
      critical: false,
      secret_ref: 'aws-sm://dev/digilocker',
    };
    expect(buildSimulationMarker(binding, 'run-xyz')).toBeNull();
  });
});

describe('isSimulationMarker', () => {
  it('accepts a valid marker', () => {
    expect(
      isSimulationMarker({
        simulation: true,
        scenario: 'digilocker_publish',
        test_run_id: 'run-001',
        connector_binding_id: BINDING_ID,
        environment: 'LOCAL',
      }),
    ).toBe(true);
  });

  it('rejects extra keys', () => {
    expect(
      isSimulationMarker({
        simulation: true,
        scenario: 'digilocker_publish',
        test_run_id: 'run-001',
        connector_binding_id: BINDING_ID,
        environment: 'LOCAL',
        extra: true,
      }),
    ).toBe(false);
  });
});
