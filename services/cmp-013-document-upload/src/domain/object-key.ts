import { buildObjectKey } from '@serviceform/storage';
import { Cmp013Error, detail } from '../errors.js';
import { isUuid } from './uuid.js';

const CELL_ID = /^cell-[a-z0-9-]{1,40}$/;
const MAX_KEY_LENGTH = 512;

function isKeyChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 47 ||
    code === 95 ||
    code === 45
  );
}

/**
 * Traversal-safe storage key: only [A-Za-z0-9/_-], no empty, dot or dot-dot segments, no
 * leading/trailing slash, no encoded or control characters. Never derived from a filename.
 */
export function isSafeObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  for (let i = 0; i < key.length; i += 1) {
    if (!isKeyChar(key.charCodeAt(i))) return false;
  }
  const segments = key.split('/');
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

export function assertSafeObjectKey(key: string): void {
  if (!isSafeObjectKey(key)) throw new Cmp013Error('SF-SYS-003', detail('OBJECT_KEY_UNSAFE'));
}

export function isKeyOwnedByTenant(key: string, tenantId: string): boolean {
  return isSafeObjectKey(key) && key.startsWith(`t/${tenantId}/`);
}

/** Tenant/cell-scoped opaque key from server-generated identifiers only (CMP-032 key scheme). */
export function documentObjectKey(input: {
  tenantId: string;
  cellId: string;
  documentId: string;
  checksumSha256: string;
}): string {
  if (!isUuid(input.tenantId) || !isUuid(input.documentId) || !CELL_ID.test(input.cellId)) {
    throw new Cmp013Error('SF-SYS-003', detail('OBJECT_KEY_UNSAFE'));
  }
  if (!/^[0-9a-f]{64}$/.test(input.checksumSha256)) {
    throw new Cmp013Error('SF-SYS-003', detail('CHECKSUM_INVALID'));
  }
  const key = buildObjectKey({
    tenantId: input.tenantId.toLowerCase(),
    cellId: input.cellId,
    objectId: input.documentId.toLowerCase(),
    contentSha256: input.checksumSha256,
  });
  assertSafeObjectKey(key);
  return key;
}
