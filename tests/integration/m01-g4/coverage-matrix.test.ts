import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SF-M01-G4-002 coverage contract: the regression harness must name all 11
 * M01 CMPs. Runtime execution evidence is produced by scripts/ci/run-m01-g4-regression.sh.
 */
const REQUIRED_CMPS = [
  'CMP-002',
  'CMP-003',
  'CMP-030',
  'CMP-031',
  'CMP-032',
  'CMP-036',
  'CMP-037',
  'CMP-038',
  'CMP-047',
  'CMP-048',
  'CMP-055',
] as const;

describe('SF-M01-G4-002 M01 regression coverage matrix', () => {
  it('lists all 11 M01 components exactly once', () => {
    expect(REQUIRED_CMPS).toHaveLength(11);
    expect(new Set(REQUIRED_CMPS).size).toBe(11);
  });

  it('regression harness script references every required CMP id', () => {
    const script = readFileSync(
      resolve(process.cwd(), 'scripts/ci/run-m01-g4-regression.sh'),
      'utf8',
    );
    for (const cmp of REQUIRED_CMPS) {
      expect(script, `harness must reference ${cmp}`).toContain(cmp);
    }
    expect(script).toContain('INT-011');
    expect(script).toContain('INT-013');
    expect(script).toContain('run-m01-envelope-int.sh');
    expect(script).toContain('host-wave2-composition');
    expect(script).toContain('contracts_lock_gate');
    expect(script).toContain('deps:graph');
  });

  it('envelope allowed_write_paths stay additive (no production service writes)', () => {
    const envelope = readFileSync(
      resolve(process.cwd(), 'orchestrator/handovers/SF-M01-G4-002.yaml'),
      'utf8',
    );
    expect(envelope).toContain('scripts/ci/run-m01-g4-regression.sh');
    expect(envelope).toContain('tests/integration/m01-g4/**');
    expect(envelope).toContain('evidence/SF-M01-G4-002/**');
    expect(envelope).toMatch(/certified:\s*false/);
  });
});
