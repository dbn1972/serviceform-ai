import type { DeploymentEnvironment } from '@serviceform/contracts';
import { Cmp011Error } from './errors.js';

export type ConnectorMode = 'OFF' | 'SIMULATED';

export const SIMULATION_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
] as const;

const DEPLOYMENT_ENVIRONMENTS: readonly string[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
];

function positiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment {
  const value = raw === undefined || raw.length === 0 ? 'LOCAL' : raw;
  if (!DEPLOYMENT_ENVIRONMENTS.includes(value)) {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

/** CMP-012 is M07: REAL and SANDBOX DigiLocker modes are refused in M04; SIMULATED never in PRODUCTION. */
export function assertDigiLockerModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
): ConnectorMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'DIGILOCKER_REAL_FORBIDDEN' }] });
  }
  if (mode !== 'OFF' && mode !== 'SIMULATED') {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'DIGILOCKER_MODE_INVALID' }] });
  }
  if (mode === 'SIMULATED' && environment === 'PRODUCTION') {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
  return mode;
}

export interface EvidenceConfig {
  environment: DeploymentEnvironment;
  digiLockerMode: ConnectorMode;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EvidenceConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const digiLockerMode = assertDigiLockerModeAllowed(
    env['SF_CMP011_DIGILOCKER_MODE'] ?? 'SIMULATED',
    environment,
  );
  return {
    environment,
    digiLockerMode,
    rateLimitMax: positiveInt(env['SF_CMP011_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(env['SF_CMP011_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
