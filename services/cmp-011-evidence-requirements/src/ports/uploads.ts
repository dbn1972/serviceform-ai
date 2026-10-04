import type { AssuranceLevel, EvidenceSource } from '../domain/policy.js';
import type { VerificationState } from '../domain/resolver.js';

export interface UploadedEvidence {
  evidence_ref: string;
  evidence_type_code: string | null;
  source: EvidenceSource;
  verification: VerificationState;
  scope: 'APPLICATION' | 'PROFILE';
  assurance?: AssuranceLevel;
  issued_at?: string;
  expires_at?: string;
}

/** CMP-013 Document Upload Service, consumed through this port only (M04 Wave A isolation). */
export interface UploadedEvidencePort {
  listEvidence(input: {
    tenant_id: string;
    subject_id: string;
    application_ref?: string;
  }): Promise<UploadedEvidence[]>;
}

export class EmptyUploadedEvidencePort implements UploadedEvidencePort {
  async listEvidence(): Promise<UploadedEvidence[]> {
    return [];
  }
}
