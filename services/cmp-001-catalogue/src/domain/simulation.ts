import { validate } from '@serviceform/contracts';
import { Cmp001Error } from '../errors.js';

export interface ConnectorBindingView {
  critical: boolean;
  mode: 'REAL' | 'SANDBOX' | 'SIMULATED';
  environment: string;
  connector_binding_id?: string;
}

const SIM_OK = new Set(['LOCAL', 'CI', 'DEVELOPMENT', 'SIT', 'PERFORMANCE']);

/** INT-013: production fails closed if a critical connector would silently SIMULATE. */
export function assertSimulationPolicy(bindings: ConnectorBindingView[]): void {
  for (const binding of bindings) {
    if (binding.mode !== 'SIMULATED') continue;
    if (binding.environment === 'PRODUCTION' && binding.critical) {
      throw new Cmp001Error('SF-INT-001', {
        details: [{ code: 'CRITICAL_SIMULATED_IN_PRODUCTION' }],
      });
    }
    if (!SIM_OK.has(binding.environment)) {
      throw new Cmp001Error('SF-INT-001', {
        details: [{ code: 'SIMULATED_ENVIRONMENT_REFUSED' }],
      });
    }
    if (binding.connector_binding_id) {
      const marker = {
        simulation: true as const,
        scenario: 'catalogue_probe',
        test_run_id: 'cmp-001-int-013',
        connector_binding_id: binding.connector_binding_id,
        environment: binding.environment,
      };
      const checked = validate('simulation-marker', marker);
      if (!checked.valid) {
        throw new Cmp001Error('SF-INT-001', { details: [{ code: 'INVALID_SIMULATION_MARKER' }] });
      }
    }
  }
}
