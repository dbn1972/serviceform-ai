import type { DeploymentEnvironment, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { Cmp051Error } from './errors.js';

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
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertConnectorModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
  label: string,
): asserts mode is ConnectorMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: `${label}_REAL_FORBIDDEN` }] });
  }
  if (mode !== 'OFF' && mode !== 'SIMULATED' && mode !== 'LOCAL') {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: `${label}_MODE_INVALID` }] });
  }
  if (environment === 'PRODUCTION' && mode === 'SIMULATED') {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
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
    throw new Cmp051Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export interface MakerCheckerConfig {
  environment: DeploymentEnvironment;
  metadataMode: ConnectorMode;
  aiMode: ConnectorMode;
  versioningMode: ConnectorMode;
  metadataBindingId: string;
  aiBindingId: string;
  versioningBindingId: string;
  testRunId: string;
  scenario: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MakerCheckerConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const metadataMode = env['SF_CMP051_METADATA_MODE'] ?? 'SIMULATED';
  const aiMode = env['SF_CMP051_AI_MODE'] ?? 'OFF';
  const versioningMode = env['SF_CMP051_VERSIONING_MODE'] ?? 'SIMULATED';
  assertConnectorModeAllowed(metadataMode, environment, 'METADATA');
  assertConnectorModeAllowed(aiMode, environment, 'AI');
  assertConnectorModeAllowed(versioningMode, environment, 'VERSIONING');
  return {
    environment,
    metadataMode,
    aiMode,
    versioningMode,
    metadataBindingId:
      env['SF_CMP051_METADATA_BINDING_ID'] ?? '05105105-1051-4051-8051-051051051051',
    aiBindingId: env['SF_CMP051_AI_BINDING_ID'] ?? '05104305-1043-4043-8043-051043051043',
    versioningBindingId:
      env['SF_CMP051_VERSIONING_BINDING_ID'] ?? '05105205-1052-4052-8052-051052051052',
    testRunId: env['SF_CMP051_TEST_RUN_ID'] ?? 'cmp051-local',
    scenario: env['SF_CMP051_SCENARIO'] ?? 'review_success',
    rateLimitMax: positiveInt(env['SF_CMP051_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(env['SF_CMP051_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
