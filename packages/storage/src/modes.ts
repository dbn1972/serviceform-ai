import type { DeploymentEnvironment } from '@serviceform/contracts';
import { StoragePortError } from './errors.js';

/** v1 Wave 2 storage modes. REAL/SANDBOX require ADR-STORAGE-INFRA. */
export type StorageMode = 'SIMULATED' | 'LOCAL';

export const SIMULATION_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
] as const;

export type SimulationEnvironment = (typeof SIMULATION_ENVIRONMENTS)[number];

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment {
  if (raw === undefined || raw.length === 0) {
    throw new StoragePortError('SF_ENVIRONMENT_REQUIRED', 'SF_ENVIRONMENT is required');
  }
  const allowed: readonly string[] = [
    'LOCAL',
    'CI',
    'DEVELOPMENT',
    'SIT',
    'PERFORMANCE',
    'UAT',
    'PREPROD',
    'PRODUCTION',
  ];
  if (!allowed.includes(raw)) {
    throw new StoragePortError('SF_ENVIRONMENT_INVALID', 'SF_ENVIRONMENT is not a known value');
  }
  return raw as DeploymentEnvironment;
}

export function assertStorageModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
): asserts mode is StorageMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new StoragePortError(
      'REAL_STORAGE_FORBIDDEN',
      'REAL/SANDBOX object storage requires ADR-STORAGE-INFRA; Wave 2 uses SIMULATED/local only',
    );
  }
  if (mode !== 'SIMULATED' && mode !== 'LOCAL') {
    throw new StoragePortError('STORAGE_MODE_INVALID', `Unsupported storage mode: ${mode}`);
  }
  if (environment === 'PRODUCTION' && mode !== 'LOCAL') {
    // PRODUCTION must not run SIMULATED critical connectors; refuse until REAL ADR lands.
    throw new StoragePortError(
      'PRODUCTION_SIMULATED_FORBIDDEN',
      'SIMULATED storage is forbidden in PRODUCTION without REAL infra ADR',
    );
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new StoragePortError(
      'SIMULATED_ENV_FORBIDDEN',
      'SIMULATED storage allowed only in LOCAL, CI, DEVELOPMENT, SIT, PERFORMANCE',
    );
  }
}
