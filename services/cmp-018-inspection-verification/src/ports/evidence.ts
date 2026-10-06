/**
 * INT-006: reuse M04 evidence (CMP-011) and document (CMP-013) via ports. Never clone those
 * services or read their tables. Technical acceptance is separate from inspection verification.
 */
export type TechnicalAcceptance = 'PENDING' | 'ACCEPTED' | 'REJECTED_TECHNICAL';

export interface EvidenceLookup {
  evidence_id?: string;
  document_id?: string;
}

export interface EvidenceView {
  evidence_id?: string;
  document_id?: string;
  technical_acceptance: TechnicalAcceptance;
}

export interface EvidencePort {
  lookup(tenantId: string, ref: EvidenceLookup): Promise<EvidenceView>;
}
