import type { SimulationMarker } from '@serviceform/contracts';
import { buildStorageSimulationMarker } from '@serviceform/storage';
import type { MalwareScanPort, ScanOutcome } from '../ports/scan-port.js';

/** Synthetic test signature; the SIMULATED engine flags any object containing it. */
export const SIMULATED_MALWARE_SIGNATURE = 'SF-SIMULATED-MALWARE-SIGNATURE';

export interface SimulatedMalwareScannerOptions {
  environment: string;
  testRunId: string;
  connectorBindingId: string;
  read: (tenantId: string, objectKey: string) => Promise<Uint8Array | null>;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(haystack).indexOf(Buffer.from(needle)) !== -1;
}

/** INT-013 SIMULATED scanner. Refuses non-simulation environments at construction. */
export class SimulatedMalwareScanner implements MalwareScanPort {
  readonly mode = 'SIMULATED' as const;
  readonly connectorBindingId: string;
  readonly simulation: SimulationMarker;
  private readonly signature = new TextEncoder().encode(SIMULATED_MALWARE_SIGNATURE);

  constructor(private readonly opts: SimulatedMalwareScannerOptions) {
    this.connectorBindingId = opts.connectorBindingId;
    this.simulation = buildStorageSimulationMarker({
      environment: opts.environment,
      scenario: 'malware_scan',
      testRunId: opts.testRunId,
      storageBindingId: opts.connectorBindingId,
    });
  }

  async scan(input: { tenantId: string; objectKey: string }): Promise<ScanOutcome> {
    const bytes = await this.opts.read(input.tenantId, input.objectKey);
    if (!bytes) throw new Error('scan target unavailable');
    return {
      verdict: contains(bytes, this.signature) ? 'INFECTED' : 'CLEAN',
      engine_ref: 'sim-malware-scan',
      simulation: this.simulation,
    };
  }
}
