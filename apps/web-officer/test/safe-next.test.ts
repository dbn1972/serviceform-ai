import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/safe-next';

describe('officer sign-in safeNext (open-redirect guard, SEC F-04)', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/applications')).toBe('/applications');
    expect(safeNext('/applications/x?y=1')).toBe('/applications/x?y=1');
  });

  it('rejects off-site, protocol-relative and dot-segment payloads', () => {
    for (const next of [
      undefined,
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/.//evil.example',
      '/..//evil.example',
      '/%2e//evil.example',
      '/a/..//evil.example',
    ]) {
      expect(safeNext(next), String(next)).toBe('/applications');
    }
  });
});
