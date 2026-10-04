import { assertNoOpenTransaction } from '../domain/txn-guard.js';
import type { DigiLockerClaim, DigiLockerPort } from '../ports.js';

/** INT-013 SIMULATED DigiLocker. Never contacts a live provider. CMP-012 remains M07. */
export class SimulatedDigiLockerAdapter implements DigiLockerPort {
  async fetchVerifiedClaims(input: {
    subject_id: string;
    scenario: string;
    test_run_id: string;
  }): Promise<{ claims: DigiLockerClaim[]; simulation: true }> {
    assertNoOpenTransaction();
    if (input.scenario === 'empty') {
      return { claims: [], simulation: true };
    }
    const claims: DigiLockerClaim[] = [
      {
        section_code: 'IDENTITY',
        claim_code: 'DISPLAY_NAME',
        value_text: 'SIMULATED_SUBJECT',
        source_ref: `sim:${input.test_run_id}`,
      },
      {
        section_code: 'ADDRESS',
        claim_code: 'LOCALITY',
        value_text: 'SIMULATED_LOCALITY',
        source_ref: `sim:${input.test_run_id}`,
      },
      {
        section_code: 'OCCUPATION',
        claim_code: 'OCCUPATION_TITLE',
        value_text: 'SIMULATED_TITLE',
        source_ref: `sim:${input.test_run_id}`,
      },
      {
        section_code: 'FAMILY',
        claim_code: 'MEMBER_DISPLAY_NAME',
        value_text: 'SIMULATED_MEMBER',
        source_ref: `sim:${input.test_run_id}`,
      },
    ];
    return { claims, simulation: true };
  }
}
