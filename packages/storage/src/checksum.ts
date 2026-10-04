import { createHash } from 'node:crypto';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Fingerprint(parts: readonly string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')}`;
}

export function assertChecksum(bytes: Uint8Array, expectedSha256Hex: string): void {
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha256Hex.toLowerCase()) {
    throw new Error('checksum mismatch');
  }
}
