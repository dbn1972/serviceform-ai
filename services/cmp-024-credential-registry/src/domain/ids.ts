import { createHash } from 'node:crypto';

/** Stable UUID-shaped resource id for audit records about a tenant collection (no row needed). */
export function collectionResourceId(tenantId: string, label: string): string {
  const hex = createHash('sha256').update(`cmp-024|${tenantId}|${label}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
