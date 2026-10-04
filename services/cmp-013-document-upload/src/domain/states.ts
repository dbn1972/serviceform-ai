export type DocumentStatus = 'PENDING_UPLOAD' | 'SCAN_PENDING' | 'AVAILABLE' | 'REJECTED';
export type SessionStatus = 'OPEN' | 'COMPLETED' | 'EXPIRED' | 'REJECTED';
export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'ERROR';

const TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  PENDING_UPLOAD: ['SCAN_PENDING', 'REJECTED'],
  SCAN_PENDING: ['SCAN_PENDING', 'AVAILABLE', 'REJECTED'],
  AVAILABLE: [],
  REJECTED: [],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Technical acceptance only (Constitution #15): AVAILABLE means integrity + policy + CLEAN scan.
 * CMP-013 never declares evidence business-verified.
 */
export function isUsableAsEvidence(status: DocumentStatus): boolean {
  return status === 'AVAILABLE';
}
