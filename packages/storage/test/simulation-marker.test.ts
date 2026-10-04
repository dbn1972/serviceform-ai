import { describe, expect, it } from 'vitest';
import { buildStorageSimulationMarker } from '../src/simulation-marker.js';
import { StoragePortError } from '../src/errors.js';

const BINDING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('simulation-marker', () => {
  it('builds a valid SF-CON-SIMULATION-MARKER', () => {
    const marker = buildStorageSimulationMarker({
      environment: 'LOCAL',
      scenario: 'store_success',
      testRunId: 'run-1',
      storageBindingId: BINDING,
    });
    expect(marker.simulation).toBe(true);
    expect(marker.connector_binding_id).toBe(BINDING);
  });

  it('rejects empty test_run_id and non-simulation envs', () => {
    expect(() =>
      buildStorageSimulationMarker({
        environment: 'LOCAL',
        scenario: 'store_success',
        testRunId: '  ',
        storageBindingId: BINDING,
      }),
    ).toThrow(StoragePortError);
    expect(() =>
      buildStorageSimulationMarker({
        environment: 'PRODUCTION',
        scenario: 'store_success',
        testRunId: 'run-1',
        storageBindingId: BINDING,
      }),
    ).toThrow(StoragePortError);
  });
});
