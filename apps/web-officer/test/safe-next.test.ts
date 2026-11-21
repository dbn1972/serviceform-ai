import { describe, expect, it } from 'vitest';
import { deskHomeForRoles } from '../lib/portal/desk';
import { safeNext } from '../lib/safe-next';

describe('officer sign-in safeNext (open-redirect guard, SEC F-04)', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/applications')).toBe('/applications');
    expect(safeNext('/applications/x?y=1')).toBe('/applications/x?y=1');
    expect(safeNext('/applications?desk=SAMPLE_LAB_SCRUTINY_OFFICER')).toBe(
      '/applications?desk=SAMPLE_LAB_SCRUTINY_OFFICER',
    );
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

  it('role-aware desk fallback still rejects open redirects (SF-50)', () => {
    const helpdesk = deskHomeForRoles(['SAMPLE_LAB_HELPDESK_L1']);
    expect(safeNext('//evil.example', helpdesk)).toBe('/helpdesk');
    expect(safeNext('/.//evil.example', helpdesk)).toBe('/helpdesk');
  });
});
