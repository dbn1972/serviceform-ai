import type { EventEnvelope } from '@serviceform/contracts';
import type { UploadTarget } from '../../src/ports/storage-port.js';
import { auth, idem, PDF_POLICY, sha256, type Harness } from './fixtures.js';

export interface SessionBody {
  session_id: string;
  document_id: string;
  expires_at: string;
  upload: UploadTarget | null;
  [key: string]: unknown;
}

export async function createPolicy(
  h: Harness,
  token = 't1-officer',
  body: Record<string, unknown> = { ...PDF_POLICY },
) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/upload-policies',
    headers: auth(token, idem('policy')),
    payload: body,
  });
}

export async function openSession(
  h: Harness,
  token: string,
  bytes: Uint8Array,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = idem('session'),
) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/documents/upload-sessions',
    headers: auth(token, headers),
    payload: {
      policy_code: PDF_POLICY.policy_code,
      content_type: 'application/pdf',
      byte_size: bytes.byteLength,
      checksum_sha256: sha256(bytes),
      ...overrides,
    },
  });
  return { res, body: res.json() as SessionBody };
}

export async function putBytes(
  h: Harness,
  upload: UploadTarget | null,
  bytes: Uint8Array,
  contentType = 'application/pdf',
): Promise<void> {
  if (!upload) throw new Error('no upload target');
  await h.storage.simulateClientPut(
    upload.url,
    bytes,
    { 'content-type': contentType },
    new Date(h.clock.now),
  );
}

export async function complete(h: Harness, token: string, documentId: string) {
  return h.app.inject({
    method: 'POST',
    url: `/v1/documents/${documentId}/complete`,
    headers: auth(token),
  });
}

export async function getDoc(h: Harness, token: string, documentId: string, suffix = '') {
  return h.app.inject({
    method: 'GET',
    url: `/v1/documents/${documentId}${suffix}`,
    headers: auth(token),
  });
}

export function scanRequestFor(
  events: EventEnvelope<object>[],
  documentId: string,
): EventEnvelope<object> {
  const found = events
    .filter(
      (e) =>
        e.event_type === 'DocumentScanRequested' &&
        (e.data as { document_id?: string }).document_id === documentId,
    )
    .at(-1);
  if (!found) throw new Error('no scan request');
  return found;
}
