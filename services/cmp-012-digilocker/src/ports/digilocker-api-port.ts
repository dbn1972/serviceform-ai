import type { SimulationMarker } from '../domain/simulation.js';

export interface DigiLockerPublishRequest {
  publishRequestId: string;
  tenantId: string;
  credentialId: string;
  consentRef: string;
  purposeCode: string;
  documentTypeRef: string;
  storageKey: string;
  idempotencyKey: string;
  simulationMarker: SimulationMarker | null;
}

export interface DigiLockerPublishResult {
  status: 'PUBLISHED' | 'FAILED';
  providerTransactionRef?: string;
  failureCode?: string;
}

export interface DigiLockerApiPort {
  readonly mode: 'REAL' | 'SANDBOX' | 'SIMULATED';
  publish(request: DigiLockerPublishRequest): Promise<DigiLockerPublishResult>;
}
