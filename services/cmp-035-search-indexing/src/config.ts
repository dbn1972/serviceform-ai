import { Cmp035Error, detail } from './errors.js';

export const DEPLOYMENT_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

const SIMULATION_ENVIRONMENTS: readonly DeploymentEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
];

export interface Cmp035Config {
  environment: DeploymentEnvironment;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Cmp035Config {
  const raw = env['SF_ENVIRONMENT'];
  const value = raw === undefined || raw.length === 0 ? 'LOCAL' : raw;
  if (!(DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new Cmp035Error('SF-SYS-003', { details: detail('SF_ENVIRONMENT_INVALID') });
  }
  return { environment: value as DeploymentEnvironment };
}

/** INT-013: a SIMULATED port never runs in PRODUCTION and only in simulation environments. */
export function assertPortAllowed(
  port: object,
  environment: DeploymentEnvironment,
  label: string,
): void {
  const simulated = (port as { simulation?: unknown }).simulation === 'SIMULATED';
  if (!simulated) return;
  if (environment === 'PRODUCTION') {
    throw new Cmp035Error('SF-SYS-003', {
      details: detail(`${label}_PRODUCTION_SIMULATED_FORBIDDEN`),
    });
  }
  if (!SIMULATION_ENVIRONMENTS.includes(environment)) {
    throw new Cmp035Error('SF-SYS-003', { details: detail(`${label}_SIMULATED_ENV_FORBIDDEN`) });
  }
}
