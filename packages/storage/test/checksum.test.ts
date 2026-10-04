import { describe, expect, it } from 'vitest';
import { assertChecksum, sha256Fingerprint, sha256Hex } from '../src/checksum.js';

describe('checksum', () => {
  it('hashes bytes and fingerprints', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(sha256Hex(bytes)).toHaveLength(64);
    expect(sha256Fingerprint(['a', 'b']).startsWith('sha256:')).toBe(true);
  });

  it('assertChecksum rejects mismatch', () => {
    const bytes = new TextEncoder().encode('x');
    expect(() => assertChecksum(bytes, '00'.repeat(32))).toThrow(/checksum/);
  });
});
