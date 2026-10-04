import { Cmp013Error, detail } from '../errors.js';
import { isSniffableContentType, sniffContentType } from './content-type.js';

export type DocumentClassification = 'TENANT_SCOPED' | 'CITIZEN_PRIVATE';

/** Tenant upload policy version (metadata). Size/type limits are never hard-coded in code. */
export interface UploadPolicy {
  policy_id: string;
  policy_code: string;
  version_no: number;
  status: 'ACTIVE' | 'RETIRED';
  allowed_content_types: string[];
  max_bytes: number;
  session_ttl_seconds: number;
  max_scan_attempts: number;
  classification: DocumentClassification;
}

export interface UploadDeclaration {
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
}

export interface ObservedObject {
  byte_size: number;
  checksum_sha256: string;
  head: Uint8Array;
}

export type UploadRejectionCode =
  | 'CHECKSUM_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'SIZE_EXCEEDS_POLICY'
  | 'CONTENT_TYPE_MISMATCH'
  | 'CONTENT_TYPE_UNRECOGNISED'
  | 'CONTENT_TYPE_NOT_ALLOWED';

export type ObservedVerdict =
  { ok: true; detected_content_type: string } | { ok: false; code: UploadRejectionCode };

/** Fails closed: a missing, retired or unverifiable policy cannot authorize an upload. */
export function assertPolicyUsable(policy: UploadPolicy | null): UploadPolicy {
  if (!policy || policy.status !== 'ACTIVE') {
    throw new Cmp013Error('SF-SYS-003', detail('UPLOAD_POLICY_UNAVAILABLE'));
  }
  if (
    policy.allowed_content_types.length === 0 ||
    !policy.allowed_content_types.every(isSniffableContentType) ||
    !(policy.max_bytes > 0)
  ) {
    throw new Cmp013Error('SF-SYS-003', detail('UPLOAD_POLICY_INVALID'));
  }
  return policy;
}

export function assertPolicyDefinition(input: { allowed_content_types: string[] }): void {
  const unknown = input.allowed_content_types.filter((t) => !isSniffableContentType(t));
  if (unknown.length > 0) {
    throw new Cmp013Error('SF-SYS-003', detail('CONTENT_TYPE_NOT_VERIFIABLE'));
  }
}

/** Declared values are checked before any upload target is issued. */
export function assertDeclarationAllowed(policy: UploadPolicy, decl: UploadDeclaration): void {
  if (!policy.allowed_content_types.includes(decl.content_type)) {
    throw new Cmp013Error('SF-SYS-003', detail('CONTENT_TYPE_NOT_ALLOWED'));
  }
  if (!Number.isSafeInteger(decl.byte_size) || decl.byte_size < 1) {
    throw new Cmp013Error('SF-SYS-003', detail('EMPTY_CONTENT'));
  }
  if (decl.byte_size > policy.max_bytes) {
    throw new Cmp013Error('SF-SYS-003', detail('SIZE_EXCEEDS_POLICY'));
  }
}

/** Observed object must match the declaration and the pinned policy byte-for-byte. */
export function evaluateObserved(
  policy: UploadPolicy,
  decl: UploadDeclaration,
  observed: ObservedObject,
): ObservedVerdict {
  if (observed.byte_size > policy.max_bytes) return { ok: false, code: 'SIZE_EXCEEDS_POLICY' };
  if (observed.byte_size !== decl.byte_size) return { ok: false, code: 'SIZE_MISMATCH' };
  if (observed.checksum_sha256.toLowerCase() !== decl.checksum_sha256.toLowerCase()) {
    return { ok: false, code: 'CHECKSUM_MISMATCH' };
  }
  const sniffed = sniffContentType(observed.head);
  if (sniffed === null) return { ok: false, code: 'CONTENT_TYPE_UNRECOGNISED' };
  if (!policy.allowed_content_types.includes(sniffed)) {
    return { ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' };
  }
  if (sniffed !== decl.content_type) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  return { ok: true, detected_content_type: sniffed };
}
