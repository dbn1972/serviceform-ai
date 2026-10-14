import type {
  DigiLockerApiPort,
  DigiLockerPublishRequest,
  DigiLockerPublishResult,
} from '../ports/digilocker-api-port.js';
import type { SimulationMarker } from '../domain/simulation.js';

/**
 * SIMULATED DigiLocker adapter. No network calls. Exercises the full publish → outbox path.
 * Deterministic outcomes from scenario name. HMAC or secrets are never needed: uses test_run_id
 * as a deterministic handle.
 *
 * Scenarios:
 *   digilocker_publish       -> PUBLISHED (default)
 *   digilocker_publish_fail  -> FAILED
 */
export class SimulatedDigiLockerConnector implements DigiLockerApiPort {
  readonly mode = 'SIMULATED' as const;
  readonly simulation: SimulationMarker;

  constructor(simulation: SimulationMarker) {
    this.simulation = simulation;
  }

  publish(request: DigiLockerPublishRequest): Promise<DigiLockerPublishResult> {
    // Use this connector's own scenario for deterministic outcomes, not the request marker
    const scenario = this.simulation.scenario;
    if (scenario.endsWith('_fail')) {
      return Promise.resolve({
        status: 'FAILED',
        failureCode: 'SF-INT-001',
      });
    }
    const providerRef = `sim:${request.publishRequestId}:${this.simulation.test_run_id}`;
    return Promise.resolve({
      status: 'PUBLISHED',
      providerTransactionRef: providerRef,
    });
  }
}
