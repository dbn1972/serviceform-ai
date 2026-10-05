import type { DeploymentEnvironment, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { Cmp009Error } from './errors.js';

export type ConnectorMode = 'OFF' | 'SIMULATED';
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
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertConnectorModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
  label: string,
): asserts mode is ConnectorMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: `${label}_REAL_FORBIDDEN` }] });
  }
  if (mode !== 'OFF' && mode !== 'SIMULATED') {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: `${label}_MODE_INVALID` }] });
  }
  if (environment === 'PRODUCTION' && mode === 'SIMULATED') {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
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
    throw new Cmp009Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export interface FormsConfig {
  environment: DeploymentEnvironment;
  formSourceMode: ConnectorMode;
  localizationMode: ConnectorMode;
  formSourceBindingId: string;
  localizationBindingId: string;
  testRunId: string;
  scenario: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FormsConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const formSourceMode = env['SF_CMP009_FORM_SOURCE_MODE'] ?? 'OFF';
  const localizationMode = env['SF_CMP009_LOCALIZATION_MODE'] ?? 'OFF';
  assertConnectorModeAllowed(formSourceMode, environment, 'FORM_SOURCE');
  assertConnectorModeAllowed(localizationMode, environment, 'LOCALIZATION');
  return {
    environment,
    formSourceMode,
    localizationMode,
    formSourceBindingId:
      env['SF_CMP009_FORM_SOURCE_BINDING_ID'] ?? '00900900-0900-4900-8900-009009009009',
    localizationBindingId:
      env['SF_CMP009_LOCALIZATION_BINDING_ID'] ?? '05305300-0530-4530-8530-053053053053',
    testRunId: env['SF_CMP009_TEST_RUN_ID'] ?? 'cmp009-local',
    scenario: env['SF_CMP009_SCENARIO'] ?? 'validate_success',
    rateLimitMax: positiveInt(env['SF_CMP009_RATE_LIMIT_MAX'] ?? '120', 120),
    rateLimitWindowMs: positiveInt(env['SF_CMP009_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
