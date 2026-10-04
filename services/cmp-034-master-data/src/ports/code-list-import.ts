import { validate, type ConnectorBinding, type SimulationMarker } from '@serviceform/contracts';
import { Cmp034Error } from '../errors.js';

export interface CodeValueInput {
  value_code: string;
  localization_key: string;
  sort_order: number;
  parent_value_code?: string;
}

export interface CodeListImportResult {
  items: CodeValueInput[];
  simulation: SimulationMarker;
}

export interface CodeListImportPort {
  fetch(
    binding: ConnectorBinding,
    scenario: string,
    testRunId: string,
  ): Promise<CodeListImportResult>;
}

export function simulatedCodeListImport(): CodeListImportPort {
  return {
    async fetch(binding, scenario, testRunId) {
      if (binding.mode !== 'SIMULATED' || !binding.simulator_version) {
        throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED' }] });
      }
      const env = binding.environment;
      if (
        env !== 'LOCAL' &&
        env !== 'CI' &&
        env !== 'DEVELOPMENT' &&
        env !== 'SIT' &&
        env !== 'PERFORMANCE'
      ) {
        throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'PRODUCTION_SIMULATED' }] });
      }
      const simulation: SimulationMarker = {
        simulation: true,
        scenario,
        test_run_id: testRunId,
        connector_binding_id: binding.connector_binding_id,
        environment: env,
      };
      const marker = validate('simulation-marker', simulation);
      if (!marker.valid) {
        throw new Cmp034Error('SF-SYS-003', { details: [{ code: 'SIMULATION_MARKER' }] });
      }
      if (scenario === 'fail_permanent') {
        throw new Cmp034Error('SF-INT-001', { details: [{ code: 'SIMULATED_FAILURE' }] });
      }
      return {
        items: [
          {
            value_code: 'ITEM_A',
            localization_key: 'md.item_a',
            sort_order: 1,
          },
          {
            value_code: 'ITEM_B',
            localization_key: 'md.item_b',
            sort_order: 2,
          },
        ],
        simulation,
      };
    },
  };
}
