import {
  validate,
  type ConnectorBinding,
  type DeploymentEnvironment,
  type SimulationMarker,
} from '@serviceform/contracts';
import { Cmp005Error } from '../errors.js';

const SIM_ENV = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

export function assertBindingSafe(
  binding: ConnectorBinding,
  deploymentEnvironment: DeploymentEnvironment,
  tenantId: string,
): void {
  if (deploymentEnvironment === 'PRODUCTION' && binding.mode !== 'REAL') {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_REFUSED' }] });
  }
  const contract: ConnectorBinding = {
    connector_binding_id: binding.connector_binding_id,
    tenant_id: binding.tenant_id,
    connector_type: binding.connector_type,
    mode: binding.mode,
    environment: binding.environment,
    critical: binding.critical,
    secret_ref: binding.secret_ref,
  };
  if (binding.service_id) contract.service_id = binding.service_id;
  if (binding.simulator_version) contract.simulator_version = binding.simulator_version;
  if (!validate('connector-binding', contract).valid) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'BINDING_INVALID' }] });
  }
  if (binding.tenant_id !== tenantId) {
    throw new Cmp005Error('SF-TEN-002');
  }
  if (binding.connector_type !== 'DIGILOCKER') {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'CONNECTOR_TYPE' }] });
  }
  if (binding.environment !== deploymentEnvironment) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'CONNECTOR_ENV' }] });
  }
}

export function requireSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  connectorBindingId: string;
}): SimulationMarker {
  if (!SIM_ENV.has(input.environment)) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: input.scenario,
    test_run_id: input.testRunId,
    connector_binding_id: input.connectorBindingId,
    environment: input.environment as SimulationMarker['environment'],
  };
  if (!validate('simulation-marker', marker).valid) {
    throw new Cmp005Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}
