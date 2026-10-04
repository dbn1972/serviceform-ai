import { sha256Fingerprint } from '@serviceform/storage';

export function storeFingerprint(body: {
  content_type: string;
  checksum_sha256: string;
  content_base64: string;
}): string {
  return sha256Fingerprint([
    'POST /storage/objects',
    body.content_type,
    body.checksum_sha256,
    body.content_base64,
  ]);
}

export function archiveFingerprint(objectId: string): string {
  return sha256Fingerprint(['POST /storage/objects/{id}/archive', objectId]);
}
