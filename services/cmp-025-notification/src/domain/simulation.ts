import { Cmp025Error, detail } from '../errors.js';
import {
  CHANNEL_CONNECTOR_TYPE,
  CONNECTOR_MODES,
  ENVIRONMENTS,
  isOneOf,
  SECRET_REF_RE,
  SIMULATION_ENVIRONMENTS,
  type Channel,
  type ConnectorMode,
  type DeploymentEnvironment,
  type SimulationEnvironment,
} from './model.js';
import { isUuid } from './uuid.js';

/** Structural mirror of SF-CON-CONNECTOR-BINDING (parity proven by test/contract). */
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
  throw new Cmp025Error('SF-INT-001', detail(code));
}

export interface BindingPolicyContext {
  tenantId: string;
  channel: Channel;
  runtimeEnvironment: DeploymentEnvironment;
}

/**
 * INT-013 + Constitution #22: every refusal is fail-closed. Order is deliberate so the most specific
 * safety refusal (critical non-REAL in PRODUCTION) is reported before generic ones.
 */
export function assertBindingPolicy(
  binding: ConnectorBindingView | null,
  policy: BindingPolicyContext,
): ConnectorBindingView {
  if (binding === null) refuse('CONNECTOR_BINDING_NOT_FOUND');
  if (binding.tenant_id !== null && binding.tenant_id !== policy.tenantId) {
    throw new Cmp025Error('SF-TEN-002');
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
  const expectedType = CHANNEL_CONNECTOR_TYPE[policy.channel];
  if (expectedType === undefined) refuse('CHANNEL_CONNECTOR_UNMAPPED');
  if (binding.connector_type !== expectedType) refuse('CONNECTOR_TYPE_MISMATCH');
  if (binding.mode === 'SIMULATED') {
    if (!binding.simulator_version) refuse('SIMULATOR_VERSION_REQUIRED');
  } else if (binding.secret_ref === null || !SECRET_REF_RE.test(binding.secret_ref)) {
    refuse('SECRET_REF_REQUIRED');
  }
  return binding;
}

export function buildSimulationMarker(
  binding: ConnectorBindingView,
  channel: Channel,
  testRunId: string | undefined,
): SimulationMarker | null {
  if (binding.mode !== 'SIMULATED') return null;
  if (testRunId === undefined || !isSimulationEnvironment(binding.environment)) {
    refuse('SIMULATION_MARKER_UNAVAILABLE');
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: `notification_${channel.toLowerCase()}`,
    test_run_id: testRunId,
    connector_binding_id: binding.connector_binding_id,
    environment: binding.environment,
  };
  if (!isSimulationMarker(marker)) refuse('INVALID_SIMULATION_MARKER');
  return marker;
}
