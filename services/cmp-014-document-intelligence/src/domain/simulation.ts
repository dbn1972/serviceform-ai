import { validate, type ConnectorMode, type DeploymentEnvironment } from '@serviceform/contracts';
import { Cmp014Error, detail } from '../errors.js';

export const SIMULATION_ENVIRONMENTS = [
  'LOCAL',
  'CI',
  'DEVELOPMENT',
  'SIT',
  'PERFORMANCE',
] as const;

export interface ConnectorBindingView {
  critical: boolean;
  mode: ConnectorMode;
  environment: string;
  connector_binding_id?: string;
}

function simulationAllowed(environment: string): boolean {
  return (SIMULATION_ENVIRONMENTS as readonly string[]).includes(environment);
}

/** INT-013: refuse SIMULATED outside simulation environments; never SIMULATED critical in PRODUCTION. */
export function assertSimulationPolicy(bindings: readonly ConnectorBindingView[]): void {
  for (const binding of bindings) {
    if (binding.mode !== 'SIMULATED') continue;
    if (binding.environment === 'PRODUCTION' && binding.critical) {
      throw new Cmp014Error('SF-INT-001', detail('CRITICAL_SIMULATED_IN_PRODUCTION'));
    }
    if (!simulationAllowed(binding.environment)) {
      throw new Cmp014Error('SF-INT-001', detail('SIMULATED_ENVIRONMENT_REFUSED'));
    }
    if (binding.connector_binding_id) {
      const marker = {
        simulation: true as const,
        scenario: 'ocr_probe',
        test_run_id: 'cmp-014-int-013',
        connector_binding_id: binding.connector_binding_id,
        environment: binding.environment,
      };
      if (!validate('simulation-marker', marker).valid) {
        throw new Cmp014Error('SF-INT-001', detail('INVALID_SIMULATION_MARKER'));
      }
    }
  }
}

export function adapterBindings(
  environment: DeploymentEnvironment,
  adapters: readonly { mode: ConnectorMode; connectorBindingId: string }[],
): ConnectorBindingView[] {
  return adapters.map((a) => ({
    critical: true,
    mode: a.mode,
    environment,
    connector_binding_id: a.connectorBindingId,
  }));
}
