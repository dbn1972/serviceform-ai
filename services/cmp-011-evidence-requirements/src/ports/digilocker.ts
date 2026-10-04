import type { SimulationMarker } from '@serviceform/contracts';
import type { AssuranceLevel } from '../domain/policy.js';

export interface DigiLockerDocument {
  document_type_ref: string;
  evidence_ref: string;
  issued_at: string;
  expires_at?: string;
  assurance: AssuranceLevel;
}

/**
 * INT-013 external dependency port for DigiLocker document discovery. Only the SIMULATED adapter exists in
 * M04; the real connector is CMP-012 (M07). References only, never document content.
 */
export interface DigiLockerEvidencePort {
  lookupDocuments(input: {
    subject_id: string;
    document_type_refs: string[];
    scenario: string;
    test_run_id: string;
  }): Promise<{ documents: DigiLockerDocument[]; simulation: SimulationMarker }>;
}
