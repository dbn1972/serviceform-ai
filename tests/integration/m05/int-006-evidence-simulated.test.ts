import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import {
  assertSimulationPolicy,
  simulationMarkerOf,
} from '../../../services/cmp-018-inspection-verification/src/domain/simulation.js';

const ROOT = join(import.meta.dirname, '../../..');
const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('INT-006 evidence/storage/OCR/verification; DigiLocker SIMULATED only (independent)', () => {
  it('CMP-018 DigiLocker SIMULATED allowed in CI with valid marker', () => {
    expect(() =>
      assertSimulationPolicy([
        {
          critical: true,
          mode: 'SIMULATED',
          environment: 'CI',
          connector_binding_id: BINDING,
        },
      ]),
    ).not.toThrow();
    const marker = simulationMarkerOf({
      critical: true,
      mode: 'SIMULATED',
      environment: 'CI',
      connector_binding_id: BINDING,
    });
    expect(marker?.simulation).toBe(true);
    expect(validate('simulation-marker', marker).valid).toBe(true);
  });

  it('CMP-018 PRODUCTION critical SIMULATED fail-closed', () => {
    try {
      assertSimulationPolicy([
        {
          critical: true,
          mode: 'SIMULATED',
          environment: 'PRODUCTION',
          connector_binding_id: BINDING,
        },
      ]);
      expect.fail('expected critical SIMULATED in PRODUCTION to throw');
    } catch (err) {
      const e = err as { code?: string; details?: Array<{ code?: string }> | { code?: string } };
      expect(e.code).toBe('SF-INT-001');
      const details = Array.isArray(e.details) ? e.details : e.details ? [e.details] : [];
      expect(
        details.some((d) => d.code === 'CRITICAL_SIMULATED_IN_PRODUCTION') ||
          String(err).includes('CRITICAL_SIMULATED'),
      ).toBe(true);
    }
  });

  it('CMP-018 uses evidence/OCR/DigiLocker ports (no invented REAL DigiLocker product)', () => {
    for (const rel of [
      'services/cmp-018-inspection-verification/src/ports/digilocker.ts',
      'services/cmp-018-inspection-verification/src/ports/ocr.ts',
      'services/cmp-018-inspection-verification/src/ports/evidence.ts',
      'services/cmp-018-inspection-verification/src/domain/simulation.ts',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src.length).toBeGreaterThan(40);
    }
    const sim = readFileSync(
      join(ROOT, 'services/cmp-018-inspection-verification/src/domain/simulation.ts'),
      'utf8',
    );
    expect(sim).toContain('digilocker_probe');
  });

  it('M04 DigiLocker SIMULATED guard still present for INT-006 dependency path', () => {
    const cfg = readFileSync(
      join(ROOT, 'services/cmp-011-evidence-requirements/src/config.ts'),
      'utf8',
    );
    expect(cfg).toContain('assertDigiLockerModeAllowed');
  });
});
