import { createHash } from 'node:crypto';

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export function requestFingerprint(method: string, path: string, body: unknown): string {
  const raw = JSON.stringify({ method, path, body: body ?? null });
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}
