import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256Prefixed(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function requestFingerprint(method: string, route: string, body: unknown): string {
  return sha256Prefixed(`${method.toUpperCase()} ${route}\n${canonicalJson(body ?? null)}`);
}

export const SHA256_PREFIXED = /^sha256:[0-9a-f]{64}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
