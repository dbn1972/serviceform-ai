import type {
  ConnectorBinding,
  ConnectorMode,
  DeploymentEnvironment,
} from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import {
  BindingInvalidError,
  ConnectorModeForbiddenError,
  ProductionSimulatedCriticalConnectorError,
} from './errors.js';

export const DEPLOYMENT_ENVIRONMENTS: readonly DeploymentEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
];

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment {
  if (raw === undefined || raw.length === 0) {
    throw new ProductionSimulatedCriticalConnectorError('SF_ENVIRONMENT is required');
  }
  if (!(DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(raw)) {
    throw new ProductionSimulatedCriticalConnectorError('SF_ENVIRONMENT is not a known value');
  }
  return raw as DeploymentEnvironment;
}

export interface EnabledBinding extends ConnectorBinding {
  enabled: boolean;
}

/**
 * Server-side mode resolution. The stored binding mode is returned unchanged.
 * Never rewrites SIMULATED over REAL or SANDBOX.
 */
export function resolveMode(
  binding: ConnectorBinding,
  opts: { deploymentEnvironment: DeploymentEnvironment },
): ConnectorMode {
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
  const result = validate('connector-binding', contract);
  if (!result.valid) throw new BindingInvalidError();
  if (binding.tenant_id === null)
    throw new BindingInvalidError('Platform-wide bindings are out of W1 scope');
  if (binding.environment !== opts.deploymentEnvironment) {
    throw new ConnectorModeForbiddenError(
      'Binding environment does not match the deployed environment',
    );
  }
  if (opts.deploymentEnvironment === 'PRODUCTION' && binding.mode !== 'REAL') {
    throw new ProductionSimulatedCriticalConnectorError();
  }
  return binding.mode;
}

export function assertProductionSafe(
  bindings: readonly EnabledBinding[],
  env: DeploymentEnvironment,
): void {
  if (env !== 'PRODUCTION') return;
  for (const binding of bindings) {
    if (!binding.enabled) continue;
    if (binding.mode !== 'REAL') {
      throw new ProductionSimulatedCriticalConnectorError();
    }
    const result = validate('connector-binding', {
      connector_binding_id: binding.connector_binding_id,
      tenant_id: binding.tenant_id,
      connector_type: binding.connector_type,
      mode: binding.mode,
      environment: binding.environment,
      critical: binding.critical,
      secret_ref: binding.secret_ref,
      ...(binding.service_id ? { service_id: binding.service_id } : {}),
      ...(binding.simulator_version ? { simulator_version: binding.simulator_version } : {}),
    });
    if (!result.valid) throw new BindingInvalidError();
  }
}
