import type { DeploymentEnvironment, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { Cmp039Error } from './errors.js';

/** REAL/SANDBOX provider adapters are not part of SF-M04-001; they fail closed. */
export type ProviderMode = 'OFF' | 'SIMULATED';

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
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertProviderModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
): asserts mode is ProviderMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'PROVIDER_REAL_FORBIDDEN' }] });
  }
  if (mode !== 'OFF' && mode !== 'SIMULATED') {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'PROVIDER_MODE_INVALID' }] });
  }
  if (mode === 'SIMULATED' && environment === 'PRODUCTION') {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
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
    throw new Cmp039Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export interface AiGatewayConfig {
  environment: DeploymentEnvironment;
  providerMode: ProviderMode;
  providerBindingId: string;
  testRunId: string;
  scenario: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AiGatewayConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const providerMode = env['SF_CMP039_PROVIDER_MODE'] ?? 'OFF';
  assertProviderModeAllowed(providerMode, environment);
  return {
    environment,
    providerMode,
    providerBindingId:
      env['SF_CMP039_PROVIDER_BINDING_ID'] ?? '03903903-1039-4039-8039-039039039039',
    testRunId: env['SF_CMP039_TEST_RUN_ID'] ?? 'cmp039-local',
    scenario: env['SF_CMP039_SCENARIO'] ?? 'advisory_success',
    rateLimitMax: positiveInt(env['SF_CMP039_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(env['SF_CMP039_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
