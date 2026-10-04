import type { DeploymentEnvironment, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { Cmp052Error } from './errors.js';

export type ConnectorMode = 'OFF' | 'SIMULATED' | 'LOCAL';
const SIMULATION_ENVIRONMENTS = ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const;
export type SimulationEnvironment = (typeof SIMULATION_ENVIRONMENTS)[number];

function positiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertConnectorModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
  label: string,
): asserts mode is ConnectorMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: `${label}_REAL_FORBIDDEN` }] });
  }
  if (mode !== 'OFF' && mode !== 'SIMULATED' && mode !== 'LOCAL') {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: `${label}_MODE_INVALID` }] });
  }
  if (environment === 'PRODUCTION' && mode === 'SIMULATED') {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: input.scenario,
    test_run_id: input.testRunId,
    connector_binding_id: input.bindingId,
    environment: input.environment as SimulationEnvironment,
  };
  const result = validate('simulation-marker', marker);
  if (!result.valid) {
    throw new Cmp052Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export interface VersioningConfig {
  environment: DeploymentEnvironment;
  approvalMode: ConnectorMode;
  approvalBindingId: string;
  testRunId: string;
  scenario: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VersioningConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const approvalMode = env['SF_CMP052_APPROVAL_MODE'] ?? 'SIMULATED';
  assertConnectorModeAllowed(approvalMode, environment, 'APPROVAL');
  return {
    environment,
    approvalMode,
    approvalBindingId:
      env['SF_CMP052_APPROVAL_BINDING_ID'] ?? '05205105-2051-4051-8051-052051052051',
    testRunId: env['SF_CMP052_TEST_RUN_ID'] ?? 'cmp052-local',
    scenario: env['SF_CMP052_SCENARIO'] ?? 'publish_success',
    rateLimitMax: positiveInt(env['SF_CMP052_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(env['SF_CMP052_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
