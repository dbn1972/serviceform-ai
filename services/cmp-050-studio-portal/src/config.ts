import type {
  DeploymentEnvironment,
  SimulationMarker,
} from '../../../packages/contracts/src/index.js';
import { validate } from '../../../packages/contracts/src/index.js';
import { Cmp050Error } from './errors.js';

const SIMULATION_ENVIRONMENTS = ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const;

export function parseDeploymentEnvironment(raw: string | undefined): DeploymentEnvironment {
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
  const value = raw === undefined || raw.length === 0 ? 'LOCAL' : raw;
  if (!allowed.includes(value)) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertSimulatedSessionAllowed(environment: DeploymentEnvironment): void {
  if (environment === 'PRODUCTION') {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildPortalSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: input.scenario,
    test_run_id: input.testRunId,
    connector_binding_id: input.bindingId,
    environment: input.environment as SimulationMarker['environment'],
  };
  const result = validate('simulation-marker', marker);
  if (!result.valid) {
    throw new Cmp050Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export type PortalConfig = {
  environment: DeploymentEnvironment;
  apiBaseUrl: string;
  sessionSecret?: string;
  testRunId: string;
  scenario: string;
  bindingId: string;
};

export function loadPortalConfig(env: NodeJS.ProcessEnv = process.env): PortalConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const secret = env['SF_PORTAL_SESSION_SECRET'];
  const config: PortalConfig = {
    environment,
    apiBaseUrl: (env['SF_API_BASE_URL'] ?? '').replace(/\/$/, ''),
    testRunId: env['SF_PORTAL_TEST_RUN_ID'] ?? 'cmp050-local',
    scenario: env['SF_PORTAL_SCENARIO'] ?? 'studio_session',
    bindingId: env['SF_PORTAL_BINDING_ID'] ?? '05005005-0050-4050-8050-050050050050',
  };
  if (typeof secret === 'string' && secret.length > 0) config.sessionSecret = secret;
  return config;
}
