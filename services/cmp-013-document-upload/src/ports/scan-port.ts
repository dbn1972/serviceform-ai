import type { ConnectorMode, SimulationMarker } from '@serviceform/contracts';

export interface ScanOutcome {
  verdict: 'CLEAN' | 'INFECTED';
  engine_ref: string;
  simulation?: SimulationMarker;
}

/**
 * Malware scanning adapter (GuardDuty/ClamAV class). A thrown error, timeout or any verdict other
 * than CLEAN keeps the document unusable (fail closed). Called outside DB transactions.
 */
export interface MalwareScanPort {
  readonly mode: ConnectorMode;
  readonly connectorBindingId: string;
  /** SF-CON-SIMULATION-MARKER; required when mode is SIMULATED. */
  readonly simulation?: SimulationMarker;
  scan(input: {
    tenantId: string;
    objectKey: string;
    checksumSha256: string;
  }): Promise<ScanOutcome>;
}
