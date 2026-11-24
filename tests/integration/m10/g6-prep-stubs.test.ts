/**
 * Workstream 5 — REAL connector config stubs must stay OWNER_REQUIRED (no invented secrets).
 * Does not claim DigiLocker/SMS/Payment REAL complete. Does not flip ADR Status.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_DIR = join(HERE, '../../../docs/verification/g6-prep/config-stubs');

const STUB_FILES = [
  'digilocker.real.env.stub',
  'sms-otp.real.env.stub',
  'payment.real.env.stub',
  'trusted-proxy.adr0008.env.stub',
] as const;

describe('M10 G6 prep config stubs (no invented credentials)', () => {
  it('stub directory lists expected REAL switch stubs', () => {
    const names = readdirSync(STUB_DIR);
    for (const file of STUB_FILES) {
      expect(names, file).toContain(file);
    }
  });

  it.each([...STUB_FILES])('%s keeps OWNER_REQUIRED and no fake secret values', (file) => {
    const text = readFileSync(join(STUB_DIR, file), 'utf8');
    expect(text).toContain('OWNER_REQUIRED');
    expect(text).toMatch(/G6=false|G6=false\./);
    // Refuse accidental committed secrets / sample keys.
    expect(text).not.toMatch(/(sk_live|sk_test|Bearer |AIza|AKIA)[A-Za-z0-9_-]/i);
    expect(text).not.toMatch(/password\s*=\s*[^\s#]+/i);
    expect(text).not.toMatch(/api[_-]?key\s*=\s*[^\s#OWNER_REQUIRED]+/i);
  });

  it('ADR readiness notes do not fake ACCEPTED status', () => {
    const adrNote = readFileSync(
      join(HERE, '../../../docs/verification/g6-prep/ADR-0007-0008-OWNER-ACCEPT-READINESS.md'),
      'utf8',
    );
    expect(adrNote).toContain('PROPOSED');
    expect(adrNote).toMatch(/do \*\*not\*\* accept|Do not flip ADR Status/i);
    expect(adrNote).not.toMatch(/Status:\s*\*\*ACCEPTED\*\*/);
  });

  it('owner blocker list keeps OB items uncleared', () => {
    const blockers = readFileSync(
      join(HERE, '../../../docs/verification/g6-prep/OWNER-BLOCKERS.md'),
      'utf8',
    );
    expect(blockers).toContain('| **No** |');
    expect(blockers).toContain('OB-03');
    expect(blockers).toContain('DigiLocker/SMS/Payment REAL=false');
  });
});
