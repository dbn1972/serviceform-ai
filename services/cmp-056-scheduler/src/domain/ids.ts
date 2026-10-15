import { createHash } from 'node:crypto';

/** Deterministic collection resource id for OPA PEP (not a stored primary key). */
export function collectionResourceId(tenantId: string, kind: string): string {
  const hex = createHash('sha256').update(`${tenantId}|${kind}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
