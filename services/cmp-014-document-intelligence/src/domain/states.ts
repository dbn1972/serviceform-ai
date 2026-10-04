export const JOB_STATUSES = [
  'ACCEPTED',
  'CLASSIFYING',
  'EXTRACTING',
  'COMPLETED',
  'NEEDS_REVIEW',
  'REVIEWED',
  'FAILED',
  'REJECTED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  ACCEPTED: ['CLASSIFYING', 'REJECTED', 'FAILED'],
  CLASSIFYING: ['EXTRACTING', 'FAILED'],
  EXTRACTING: ['COMPLETED', 'NEEDS_REVIEW', 'FAILED'],
  COMPLETED: [],
  NEEDS_REVIEW: ['REVIEWED'],
  REVIEWED: [],
  FAILED: [],
  REJECTED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to);
}

export const DOCUMENT_CLASSES = [
  'UNKNOWN',
  'IDENTITY_DOCUMENT',
  'ADDRESS_PROOF',
  'GENERIC',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export function isAllowedContentType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}
