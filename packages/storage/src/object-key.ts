import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic, tenant/cell-scoped object key. Never embeds PII.
 * Format: t/{tenantId}/c/{cellId}/o/{objectId}/{contentHash12}
 */
export function buildObjectKey(input: {
  tenantId: string;
  cellId: string;
  objectId: string;
  contentSha256: string;
}): string {
  const hash12 = input.contentSha256.slice(0, 12);
  return `t/${input.tenantId}/c/${input.cellId}/o/${input.objectId}/${hash12}`;
}

export function newObjectId(): string {
  return randomUUID();
}

export function contentHashPrefix(contentSha256: string): string {
  return createHash('sha256').update(contentSha256, 'utf8').digest('hex').slice(0, 12);
}
