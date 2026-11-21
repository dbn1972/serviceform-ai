/**
 * Citizen BFF helpers for CMP-013 document upload (SF-49).
 * Technical acceptance only (AVAILABLE after CLEAN scan) — never business verification.
 * CERTIFIED=false. G6=false.
 */
import { createHash } from 'node:crypto';
import { platform, type Citizen, type PlatformResponse } from './platform';

export const SAMPLE_LAB_UPLOAD_POLICY_CODE = 'SAMPLE_LAB_EVIDENCE';
export const MAX_UPLOAD_BYTES = 1_048_576;
export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export type DocumentStatus =
  'PENDING_UPLOAD' | 'SCAN_PENDING' | 'AVAILABLE' | 'REJECTED' | 'SCAN_FAILED';

export interface DocumentView {
  document_id: string;
  status: DocumentStatus;
  technically_accepted: boolean;
  content_type?: string;
  byte_size?: number;
  rejection_code?: string | null;
  policy_code?: string;
}

export interface UploadSessionBody {
  session_id: string;
  document_id: string;
  expires_at: string;
  session_status: string;
  document_status: string;
  upload: {
    method: string;
    url: string;
    expires_at: string;
    required_headers?: Record<string, string>;
    simulation?: { simulation: boolean };
  } | null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sanitizeFileName(name: string): string {
  const base = name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .trim()
    .slice(0, 100);
  return base.length > 0 ? base : 'evidence.bin';
}

/** Fail-closed content-type gate before calling CMP-013. */
export function assertAllowedUpload(input: {
  contentType: string;
  byteSize: number;
}): { ok: true } | { ok: false; message: string } {
  if (
    !ALLOWED_CONTENT_TYPES.includes(input.contentType as (typeof ALLOWED_CONTENT_TYPES)[number])
  ) {
    return { ok: false, message: 'This file type is not accepted. Use PDF, PNG or JPEG.' };
  }
  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_UPLOAD_BYTES
  ) {
    return { ok: false, message: 'This file is too large. Maximum size is 1 MB in SAMPLE_LAB.' };
  }
  return { ok: true };
}

/** Map an AVAILABLE CMP-013 document to a deficiency evidence attachment. */
export function toDeficiencyEvidence(
  documentId: string,
  kindCode = 'CITIZEN_UPLOAD',
): { evidence_ref: string; kind_code: string } {
  return { evidence_ref: documentId, kind_code: kindCode };
}

export function isTechnicallyAccepted(doc: DocumentView | null | undefined): boolean {
  return Boolean(doc?.technically_accepted && doc.status === 'AVAILABLE');
}

export async function createUploadSession(
  citizen: Citizen,
  input: {
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    applicationRef?: string;
    idempotencyKey: string;
  },
): Promise<{ ok: true; session: UploadSessionBody } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', '/v1/documents/upload-sessions', {
    token: citizen.token,
    idempotencyKey: input.idempotencyKey,
    body: {
      policy_code: SAMPLE_LAB_UPLOAD_POLICY_CODE,
      content_type: input.contentType,
      byte_size: input.byteSize,
      checksum_sha256: input.checksumSha256,
      ...(input.applicationRef ? { application_ref: input.applicationRef } : {}),
    },
  });
  if (res.status !== 201) return { ok: false, res };
  return { ok: true, session: res.body as unknown as UploadSessionBody };
}

export async function simulatedPut(
  citizen: Citizen,
  input: { uploadUrl: string; contentType: string; bytes: Uint8Array },
): Promise<{ ok: true } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', '/v1/simulated/document-puts', {
    token: citizen.token,
    body: {
      upload_url: input.uploadUrl,
      content_type: input.contentType,
      content_base64: Buffer.from(input.bytes).toString('base64'),
    },
  });
  if (res.status !== 200) return { ok: false, res };
  return { ok: true };
}

export async function completeUpload(
  citizen: Citizen,
  documentId: string,
): Promise<{ ok: true; document: DocumentView } | { ok: false; res: PlatformResponse }> {
  const res = await platform('POST', `/v1/documents/${documentId}/complete`, {
    token: citizen.token,
  });
  if (res.status !== 200) return { ok: false, res };
  return { ok: true, document: res.body as unknown as DocumentView };
}

export async function drainSimulatedScan(
  citizen: Citizen,
  documentId: string,
): Promise<{ ok: true; document: DocumentView } | { ok: false; res: PlatformResponse }> {
  const scan = await platform('POST', `/v1/simulated/document-scans/${documentId}`, {
    token: citizen.token,
  });
  if (scan.status !== 200) return { ok: false, res: scan };
  return getDocument(citizen, documentId);
}

export async function getDocument(
  citizen: Citizen,
  documentId: string,
): Promise<{ ok: true; document: DocumentView } | { ok: false; res: PlatformResponse }> {
  const res = await platform('GET', `/v1/documents/${documentId}`, { token: citizen.token });
  if (res.status !== 200) return { ok: false, res };
  return { ok: true, document: res.body as unknown as DocumentView };
}

/**
 * Full SAMPLE_LAB upload: session → SIMULATED put → complete → sync scan → AVAILABLE|REJECTED.
 * Fail-closed on any non-success step.
 */
export async function uploadEvidenceDocument(
  citizen: Citizen,
  input: {
    bytes: Uint8Array;
    contentType: string;
    fileName: string;
    applicationRef?: string;
    idempotencyKey: string;
  },
): Promise<
  | {
      ok: true;
      document: DocumentView;
      file_name: string;
      content_type: string;
    }
  | { ok: false; res: PlatformResponse; message?: string }
> {
  const gate = assertAllowedUpload({
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
  });
  if (!gate.ok) {
    return {
      ok: false,
      res: { status: 400, body: { error_code: 'SF-SYS-003', message: gate.message } },
      message: gate.message,
    };
  }
  const checksum = sha256Hex(input.bytes);
  const session = await createUploadSession(citizen, {
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    checksumSha256: checksum,
    ...(input.applicationRef ? { applicationRef: input.applicationRef } : {}),
    idempotencyKey: input.idempotencyKey,
  });
  if (!session.ok) return session;
  const uploadUrl = session.session.upload?.url;
  if (!uploadUrl) {
    return {
      ok: false,
      res: {
        status: 503,
        body: { error_code: 'SF-SYS-004', message: 'Upload target unavailable' },
      },
      message: 'Upload target unavailable',
    };
  }
  const put = await simulatedPut(citizen, {
    uploadUrl,
    contentType: input.contentType,
    bytes: input.bytes,
  });
  if (!put.ok) return put;
  const done = await completeUpload(citizen, session.session.document_id);
  if (!done.ok) return done;
  const scanned = await drainSimulatedScan(citizen, session.session.document_id);
  if (!scanned.ok) return scanned;
  if (!isTechnicallyAccepted(scanned.document)) {
    return {
      ok: false,
      res: {
        status: 422,
        body: {
          error_code: 'SF-EVD-002',
          message: 'The file was not technically accepted. Try a clean PDF, PNG or JPEG.',
          details: [{ code: scanned.document.rejection_code ?? scanned.document.status }],
        },
      },
      message: 'The file was not technically accepted.',
    };
  }
  return {
    ok: true,
    document: scanned.document,
    file_name: sanitizeFileName(input.fileName),
    content_type: input.contentType,
  };
}

/** Fail-closed apply gate: evidence_file_name must be an AVAILABLE CMP-013 document id. */
export async function requireAvailableEvidenceDocument(
  citizen: Citizen,
  documentId: string | undefined,
): Promise<{ ok: true; document: DocumentView } | { ok: false; message: string }> {
  if (!documentId || !/^[0-9a-f-]{36}$/i.test(documentId)) {
    return {
      ok: false,
      message: 'Upload a supporting document before you submit. Technical accept is required.',
    };
  }
  const got = await getDocument(citizen, documentId);
  if (!got.ok) {
    return {
      ok: false,
      message: 'We could not verify your uploaded document. Upload again and retry.',
    };
  }
  if (!isTechnicallyAccepted(got.document)) {
    return {
      ok: false,
      message: 'Your document is not yet technically accepted. Wait for the scan or upload again.',
    };
  }
  return { ok: true, document: got.document };
}
