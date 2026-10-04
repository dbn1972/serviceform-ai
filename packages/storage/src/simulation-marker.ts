import type { SimulationMarker } from '@serviceform/contracts';
import { validate } from '@serviceform/contracts';
import { StoragePortError } from './errors.js';
import { SIMULATION_ENVIRONMENTS, type SimulationEnvironment } from './modes.js';

export function buildStorageSimulationMarker(input: {
  environment: string;
  scenario: string;
  testRunId: string;
  /** Synthetic binding id for the SIMULATED object-store adapter (SF-CON-SIMULATION-MARKER). */
  storageBindingId: string;
}): SimulationMarker {
  if (!(SIMULATION_ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new StoragePortError(
      'SIMULATOR_ENV_REFUSED',
      'Simulator refuses this environment for storage markers',
    );
  }
  if (input.testRunId.trim().length === 0) {
    throw new StoragePortError(
      'TEST_RUN_ID_REQUIRED',
      'test_run_id is required for SIMULATED mode',
    );
  }
  const marker: SimulationMarker = {
    simulation: true,
    scenario: input.scenario,
    test_run_id: input.testRunId,
    connector_binding_id: input.storageBindingId,
    environment: input.environment as SimulationEnvironment,
  };
  const result = validate('simulation-marker', marker);
  if (!result.valid) {
    throw new StoragePortError(
      'SIMULATION_MARKER_INVALID',
      'Simulation marker failed SF-CON-SIMULATION-MARKER',
    );
  }
  return marker;
}
