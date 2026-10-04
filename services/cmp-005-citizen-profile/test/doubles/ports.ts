import type { ConsentAccessPort, DigiLockerPort, SubjectDirectoryPort } from '../../src/ports.js';

export class AllowConsent implements ConsentAccessPort {
  allowed = true;
  reason_code = 'OK';
  throws = false;
  lastPurpose: string | undefined;

  async check(input: {
    tenant_id: string;
    subject_id: string;
    purpose_code: string;
    correlation_id: string;
  }): Promise<{ allowed: boolean; reason_code: string }> {
    this.lastPurpose = input.purpose_code;
    if (this.throws) throw new Error('consent-down');
    return { allowed: this.allowed, reason_code: this.reason_code };
  }
}

export class AlwaysSubject implements SubjectDirectoryPort {
  present = true;
  async exists(): Promise<boolean> {
    return this.present;
  }
}

export class RecordingLocker implements DigiLockerPort {
  calledInTx = false;
  async fetchVerifiedClaims(): Promise<{
    claims: {
      section_code: string;
      claim_code: string;
      value_text: string;
      source_ref: string;
    }[];
    simulation: true;
  }> {
    const { isTransactionOpen } = await import('../../src/domain/txn-guard.js');
    this.calledInTx = isTransactionOpen();
    return {
      simulation: true,
      claims: [
        {
          section_code: 'IDENTITY',
          claim_code: 'DISPLAY_NAME',
          value_text: 'SIMULATED_SUBJECT',
          source_ref: 'sim:rec',
        },
      ],
    };
  }
}
