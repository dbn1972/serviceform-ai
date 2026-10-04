import type { DeploymentEnvironment, SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { Cmp033Error } from './errors.js';

export type SchemaRegistryMode = 'SIMULATED' | 'LOCAL';

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
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SF_ENVIRONMENT_INVALID' }] });
  }
  return value as DeploymentEnvironment;
}

export function assertSchemaRegistryModeAllowed(
  mode: string,
  environment: DeploymentEnvironment,
): asserts mode is SchemaRegistryMode {
  if (mode === 'REAL' || mode === 'SANDBOX') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'REAL_SCHEMA_REGISTRY_FORBIDDEN' }] });
  }
  if (mode !== 'SIMULATED' && mode !== 'LOCAL') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SCHEMA_REGISTRY_MODE_INVALID' }] });
  }
  if (environment === 'PRODUCTION' && mode === 'SIMULATED') {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED_FORBIDDEN' }] });
  }
  if (
    mode === 'SIMULATED' &&
    !(SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SIMULATED_ENV_FORBIDDEN' }] });
  }
}

export function buildMetadataSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  bindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SIMULATOR_ENV_REFUSED' }] });
  }
  if (input.testRunId.trim().length === 0) {
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'TEST_RUN_ID_REQUIRED' }] });
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
    throw new Cmp033Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER_INVALID' }] });
  }
  return marker;
}

export interface MetadataServiceConfig {
  environment: DeploymentEnvironment;
  schemaRegistryMode: SchemaRegistryMode;
  schemaBindingId: string;
  testRunId: string;
  scenario: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MetadataServiceConfig {
  const environment = parseDeploymentEnvironment(env['SF_ENVIRONMENT'] ?? 'LOCAL');
  const schemaRegistryMode = env['SF_METADATA_SCHEMA_MODE'] ?? 'SIMULATED';
  assertSchemaRegistryModeAllowed(schemaRegistryMode, environment);
  return {
    environment,
    schemaRegistryMode,
    schemaBindingId: env['SF_METADATA_SCHEMA_BINDING_ID'] ?? '03303303-3033-4033-8033-033033033033',
    testRunId: env['SF_METADATA_TEST_RUN_ID'] ?? 'cmp033-local',
    scenario: env['SF_METADATA_SCENARIO'] ?? 'validate_success',
    rateLimitMax: positiveInt(env['SF_METADATA_RATE_LIMIT_MAX'] ?? '60', 60),
    rateLimitWindowMs: positiveInt(env['SF_METADATA_RATE_LIMIT_WINDOW_MS'] ?? '60000', 60_000),
  };
}
