export type SourceKind = 'SELF' | 'OFFICER' | 'CONNECTOR';
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'STALE' | 'REVOKED';

export interface ClaimProvenanceInput {
  existingStatus: VerificationStatus | null;
  nextSourceKind: SourceKind;
  nextStatus: VerificationStatus;
}

export type ProvenanceDecision = 'ACCEPT' | 'REJECT_DOWNGRADE' | 'REJECT_CLIENT_VERIFIED';

/**
 * Verified-claim provenance machine. Does not interpret statutory meaning of claim codes.
 */
export function evaluateProvenance(input: ClaimProvenanceInput): ProvenanceDecision {
  if (input.nextSourceKind !== 'CONNECTOR' && input.nextStatus === 'VERIFIED') {
    return 'REJECT_CLIENT_VERIFIED';
  }
  if (input.existingStatus === 'VERIFIED' && input.nextStatus === 'UNVERIFIED') {
    return 'REJECT_DOWNGRADE';
  }
  return 'ACCEPT';
}

export interface VisibilityInput {
  actorId: string;
  actorType: string;
  subjectId: string;
  consentAllowed: boolean;
}

export function canExposeClaimValues(input: VisibilityInput): boolean {
  if (!input.consentAllowed) return false;
  if (input.actorType === 'CITIZEN' && input.actorId !== input.subjectId) return false;
  return true;
}
