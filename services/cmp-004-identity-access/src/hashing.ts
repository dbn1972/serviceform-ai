import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacHex(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

export function tokenFingerprint(token: string): string {
  return sha256Hex(token);
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

export function fingerprintRequest(body: unknown): string {
  return `sha256:${sha256Hex(stableStringify(body))}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}
