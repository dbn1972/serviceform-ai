import {
  validate,
  type ConnectorBinding,
  type DeploymentEnvironment,
  type SimulationMarker,
} from '@serviceform/contracts';
import { Cmp004Error } from './errors.js';

export function assertBindingAllowed(
  binding: ConnectorBinding,
  runtimeEnvironment: DeploymentEnvironment,
): void {
  const checked = validate('connector-binding', binding);
  if (!checked.valid) {
    throw new Cmp004Error('SF-INT-001', { details: [{ code: 'BINDING_INVALID' }] });
  }
  if (runtimeEnvironment === 'PRODUCTION' && binding.mode !== 'REAL') {
    throw new Cmp004Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
  if (binding.environment === 'PRODUCTION' && binding.mode === 'SIMULATED') {
    throw new Cmp004Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
  if (binding.critical && binding.mode === 'SIMULATED' && runtimeEnvironment === 'PRODUCTION') {
    throw new Cmp004Error('SF-INT-001', { details: [{ code: 'CONNECTOR_MODE_FORBIDDEN' }] });
  }
}

export function requireSimulationMarker(marker: unknown): SimulationMarker {
  const checked = validate('simulation-marker', marker);
  if (!checked.valid) {
    throw new Cmp004Error('SF-INT-001', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker as SimulationMarker;
}

export function simulatedBinding(params: {
  id: string;
  connector_type: ConnectorBinding['connector_type'];
  environment?: Extract<
    DeploymentEnvironment,
    'LOCAL' | 'CI' | 'DEVELOPMENT' | 'SIT' | 'PERFORMANCE'
  >;
  simulator_version: string;
}): ConnectorBinding {
  return {
    connector_binding_id: params.id,
    tenant_id: null,
    connector_type: params.connector_type,
    mode: 'SIMULATED',
    environment: params.environment ?? 'CI',
    critical: true,
    secret_ref: null,
    simulator_version: params.simulator_version,
  };
}
