import { Cmp021Error, detail } from '../errors.js';
import { isUuid } from './uuid.js';
import type { ConnectorMode, DeploymentEnvironment, SimulationEnvironment } from '../types.js';

export type { DeploymentEnvironment };

export const CONNECTOR_MODES: readonly ConnectorMode[] = ['REAL', 'SANDBOX', 'SIMULATED'];
export const ENVIRONMENTS: readonly DeploymentEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
  'UAT',
  'PREPROD',
  'PRODUCTION',
];
export const SIMULATION_ENVIRONMENTS: readonly SimulationEnvironment[] = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
];
export const SECRET_REF_RE = /^(aws-sm|aws-ssm|vault):\/\/[A-Za-z0-9/_.+=@-]+$/;

export function isOneOf<T extends string>(set: readonly T[], value: string): value is T {
  return (set as readonly string[]).includes(value);
}

export function isSecretRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && SECRET_REF_RE.test(value);
}

/** Structural mirror of SF-CON-CONNECTOR-BINDING. */
export interface ConnectorBindingView {
  connector_binding_id: string;
  tenant_id: string | null;
  connector_type: string;
  mode: ConnectorMode;
  environment: DeploymentEnvironment;
  critical: boolean;
  secret_ref: string | null;
  simulator_version?: string;
}

/** Structural mirror of SF-CON-SIMULATION-MARKER. */
export interface SimulationMarker {
  simulation: true;
  scenario: string;
  test_run_id: string;
  connector_binding_id: string;
  environment: SimulationEnvironment;
}

const SCENARIO_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function isSimulationEnvironment(value: string): value is SimulationEnvironment {
  return (SIMULATION_ENVIRONMENTS as readonly string[]).includes(value);
}

export function isSimulationMarker(value: unknown): value is SimulationMarker {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  const keys = Object.keys(m);
  const allowed = ['simulation', 'scenario', 'test_run_id', 'connector_binding_id', 'environment'];
  return (
    keys.length === allowed.length &&
    keys.every((k) => allowed.includes(k)) &&
    m['simulation'] === true &&
    typeof m['scenario'] === 'string' &&
    m['scenario'].length <= 64 &&
    SCENARIO_RE.test(m['scenario']) &&
    typeof m['test_run_id'] === 'string' &&
    m['test_run_id'].length >= 1 &&
    m['test_run_id'].length <= 128 &&
    typeof m['connector_binding_id'] === 'string' &&
    isUuid(m['connector_binding_id']) &&
    typeof m['environment'] === 'string' &&
    isSimulationEnvironment(m['environment'])
  );
}

function refuse(code: string): never {
  throw new Cmp021Error('SF-INT-001', detail(code));
}

export interface BindingPolicyContext {
  tenantId: string;
  runtimeEnvironment: DeploymentEnvironment;
}

/**
 * INT-013 + Constitution #22: every refusal is fail-closed. Production critical non-REAL is
 * checked first, then LOCAL/CI SIMULATED requirement, then environment match.
 */
export function assertBindingPolicy(
  binding: ConnectorBindingView | null,
  policy: BindingPolicyContext,
): ConnectorBindingView {
  if (binding === null) refuse('CONNECTOR_BINDING_NOT_FOUND');
  if (binding.tenant_id !== null && binding.tenant_id !== policy.tenantId) {
    throw new Cmp021Error('SF-TEN-002');
  }
  if (!isOneOf(CONNECTOR_MODES, binding.mode)) refuse('CONNECTOR_MODE_INVALID');
  if (!isOneOf(ENVIRONMENTS, binding.environment)) refuse('CONNECTOR_ENVIRONMENT_INVALID');
  if (binding.environment === 'PRODUCTION' && binding.critical && binding.mode !== 'REAL') {
    refuse('CRITICAL_NON_REAL_IN_PRODUCTION');
  }
  if (binding.mode === 'SIMULATED' && !isSimulationEnvironment(binding.environment)) {
    refuse('SIMULATED_ENVIRONMENT_REFUSED');
  }
  if (
    (binding.environment === 'LOCAL' || binding.environment === 'CI') &&
    binding.mode !== 'SIMULATED'
  ) {
    refuse('NON_SIMULATED_IN_LOCAL_OR_CI_REFUSED');
  }
  if (binding.environment !== policy.runtimeEnvironment) refuse('CONNECTOR_ENVIRONMENT_MISMATCH');
  if (binding.connector_type !== 'PAYMENT') refuse('CONNECTOR_TYPE_MISMATCH');
  if (binding.mode === 'SIMULATED') {
    if (!binding.simulator_version) refuse('SIMULATOR_VERSION_REQUIRED');
  } else if (!isSecretRef(binding.secret_ref)) {
    refuse('SECRET_REF_REQUIRED');
  }
  return binding;
}

export function buildSimulationMarker(
  binding: ConnectorBindingView,
  testRunId: string | undefined,
): SimulationMarker | null {
  if (binding.mode !== 'SIMULATED') return null;
  if (testRunId === undefined || !isSimulationEnvironment(binding.environment)) {
    refuse('SIMULATION_MARKER_UNAVAILABLE');
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: 'payment_gateway',
    test_run_id: testRunId,
    connector_binding_id: binding.connector_binding_id,
    environment: binding.environment,
  };
  if (!isSimulationMarker(marker)) refuse('INVALID_SIMULATION_MARKER');
  return marker;
}
