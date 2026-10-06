import { validate } from '../contracts.js';
import { Cmp018Error, detail } from '../errors.js';

export type ConnectorMode = 'REAL' | 'SANDBOX' | 'SIMULATED';

export interface ConnectorBindingView {
  critical: boolean;
  mode: ConnectorMode;
  environment: string;
  connector_binding_id?: string;
}

const SIMULATION_ENVIRONMENTS = ['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE'] as const;

/** INT-013: refuse SIMULATED outside simulation environments; never SIMULATED critical in PRODUCTION. */
export function assertSimulationPolicy(bindings: readonly ConnectorBindingView[]): void {
  for (const binding of bindings) {
    if (binding.mode !== 'SIMULATED') continue;
    if (binding.environment === 'PRODUCTION' && binding.critical) {
      throw new Cmp018Error('SF-INT-001', detail('CRITICAL_SIMULATED_IN_PRODUCTION'));
    }
    if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(binding.environment)) {
      throw new Cmp018Error('SF-INT-001', detail('SIMULATED_ENVIRONMENT_REFUSED'));
    }
    if (binding.connector_binding_id) {
      const marker = {
        simulation: true as const,
        scenario: 'digilocker_probe',
        test_run_id: 'cmp-018-int-013',
        connector_binding_id: binding.connector_binding_id,
        environment: binding.environment,
      };
      if (!validate('simulation-marker', marker).valid) {
        throw new Cmp018Error('SF-INT-001', detail('INVALID_SIMULATION_MARKER'));
      }
    }
  }
}

export function simulationMarkerOf(
  binding: ConnectorBindingView,
): Record<string, unknown> | undefined {
  if (binding.mode !== 'SIMULATED' || !binding.connector_binding_id) return undefined;
  return {
    simulation: true,
    scenario: 'digilocker_probe',
    test_run_id: 'cmp-018-int-013',
    connector_binding_id: binding.connector_binding_id,
    environment: binding.environment,
  };
}
