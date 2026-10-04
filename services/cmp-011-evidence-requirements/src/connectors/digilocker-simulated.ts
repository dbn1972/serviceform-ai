import type { SimulationMarker } from '@serviceform/contracts';
import { requireSimulationMarker } from '../domain/connector-guard.js';
import { assertNoOpenTransaction } from '../domain/txn-guard.js';
import { Cmp011Error } from '../errors.js';
import type { DigiLockerDocument, DigiLockerEvidencePort } from '../ports/digilocker.js';

export const DIGILOCKER_SCENARIOS = [
  'all_available',
  'none_available',
  'expired',
  'outage',
] as const;

/**
 * INT-013 SIMULATED DigiLocker document discovery. Never contacts a live provider; every response carries a
 * SimulationMarker. The real connector is CMP-012 (M07).
 */
export class SimulatedDigiLockerEvidenceAdapter implements DigiLockerEvidencePort {
  constructor(
    private readonly options: {
      environment: string;
      connectorBindingId: string;
      clock?: () => Date;
    },
  ) {}

  async lookupDocuments(input: {
    subject_id: string;
    document_type_refs: string[];
    scenario: string;
    test_run_id: string;
  }): Promise<{ documents: DigiLockerDocument[]; simulation: SimulationMarker }> {
    assertNoOpenTransaction();
    if (!(DIGILOCKER_SCENARIOS as readonly string[]).includes(input.scenario)) {
      throw new Cmp011Error('SF-SYS-003', { details: [{ code: 'SCENARIO_UNKNOWN' }] });
    }
    const simulation = requireSimulationMarker({
      environment: this.options.environment,
      scenario: input.scenario,
      testRunId: input.test_run_id,
      connectorBindingId: this.options.connectorBindingId,
    });
    if (input.scenario === 'outage') {
      throw new Cmp011Error('SF-SYS-004', { details: [{ code: 'DIGILOCKER_UNAVAILABLE' }] });
    }
    if (input.scenario === 'none_available') return { documents: [], simulation };
    const now = (this.options.clock ?? (() => new Date()))();
    const documents = input.document_type_refs.map((ref): DigiLockerDocument => {
      const doc: DigiLockerDocument = {
        document_type_ref: ref,
        evidence_ref: `sim:${input.test_run_id}:${ref}`,
        issued_at: new Date(now.getTime() - 86_400_000).toISOString(),
        assurance: 'HIGH',
      };
      if (input.scenario === 'expired') {
        doc.expires_at = new Date(now.getTime() - 3_600_000).toISOString();
      }
      return doc;
    });
    return { documents, simulation };
  }
}
