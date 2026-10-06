/**
 * DigiLocker identity documents are consumed only through this SIMULATED port
 * (INT-013 fail-closed for production-critical SIMULATED). Product implementation
 * of that connector is out of this slice.
 */
import type { ConnectorBindingView } from '../domain/simulation.js';

export interface DigiLockerLookup {
  document_ref: string;
}

export interface DigiLockerDocument {
  document_id: string;
  simulation_marker?: Record<string, unknown>;
}

export interface DigiLockerPort {
  binding(): ConnectorBindingView;
  lookup(tenantId: string, req: DigiLockerLookup): Promise<DigiLockerDocument>;
}
