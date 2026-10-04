import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isContentHash(value: string): boolean {
  return HASH_RE.test(value);
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

export function createRequestFingerprint(body: {
  subject_type: string;
  subject_id: string;
  proposed_hash: string;
}): string {
  return sha256Fingerprint([
    'POST /publication-requests',
    body.subject_type,
    body.subject_id,
    body.proposed_hash,
  ]);
}

export function actionFingerprint(action: string, id: string, extra = ''): string {
  return sha256Fingerprint([`POST /publication-requests/{id}/${action}`, id, extra]);
}
