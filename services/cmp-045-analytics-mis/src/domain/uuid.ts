import { createHash } from 'node:crypto';

/** Linear UUID shape check; avoids ambiguous quantifier regexes. */
export function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  const parts = value.split('-');
  if (parts.length !== 5) return false;
  const lengths = [8, 4, 4, 4, 12] as const;
  for (let i = 0; i < 5; i += 1) {
    const part = parts[i];
    if (!part || part.length !== lengths[i]) return false;
    for (let j = 0; j < part.length; j += 1) {
      const c = part.charCodeAt(j);
      const isDigit = c >= 48 && c <= 57;
      const isLower = c >= 97 && c <= 102;
      const isUpper = c >= 65 && c <= 70;
      if (!isDigit && !isLower && !isUpper) return false;
    }
  }
  return true;
}

/**
 * Deterministic name-based identifier (RFC 9562 version 8, SHA-256 derived) so a metric point keeps
 * its identity across projection rebuilds.
 */
export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash('sha256')
    .update(namespace)
    .update('\u0000')
    .update(name, 'utf8')
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const METRIC_NAMESPACE = 'sf.cmp-045.metric-point.v1';

export function metricPointId(
  tenantId: string,
  definitionId: string,
  periodStart: string,
  dimensionHash: string,
): string {
  return deterministicUuid(
    METRIC_NAMESPACE,
    `${tenantId}|${definitionId}|${periodStart}|${dimensionHash}`,
  );
}
