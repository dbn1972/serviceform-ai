import { createHash } from 'node:crypto';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function requestFingerprint(method: string, endpoint: string, body: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([method, endpoint, canonical(body ?? null)]))
    .digest('hex');
  return `sha256:${digest}`;
}
