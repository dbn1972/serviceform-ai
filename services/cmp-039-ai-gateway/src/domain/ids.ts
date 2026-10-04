import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function sha256Hash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return sha256Hash(parts.join('|'));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
