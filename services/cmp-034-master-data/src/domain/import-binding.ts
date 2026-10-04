import {
  validate,
  type ConnectorBinding,
  type DeploymentEnvironment,
} from '@serviceform/contracts';
import { Cmp034Error } from '../errors.js';

const SIM_ENVIRONMENTS = new Set<string>([
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
]);

export function assertConnectorImportSafe(
  binding: unknown,
  deploymentEnvironment: string,
): ConnectorBinding {
  const checked = validate('connector-binding', binding);
  if (!checked.valid) {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'CONNECTOR_BINDING' }] });
  }
  const value = binding as ConnectorBinding;
  if (value.connector_type !== 'DEPARTMENT_API') {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'CONNECTOR_TYPE' }] });
  }
  if (value.environment !== deploymentEnvironment) {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'CONNECTOR_ENV_MISMATCH' }] });
  }
  if (deploymentEnvironment === 'PRODUCTION' && value.mode !== 'REAL') {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED' }] });
  }
  if (value.mode === 'SIMULATED' && !SIM_ENVIRONMENTS.has(deploymentEnvironment)) {
    throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED' }] });
  }
  if (value.mode === 'REAL' || value.mode === 'SANDBOX') {
    throw new Cmp034Error('SF-INT-001', { details: [{ code: 'ADAPTER_UNAVAILABLE' }] });
  }
  return value;
}

export function isSimulatedEnvironment(env: DeploymentEnvironment | string): boolean {
  return SIM_ENVIRONMENTS.has(env);
}
