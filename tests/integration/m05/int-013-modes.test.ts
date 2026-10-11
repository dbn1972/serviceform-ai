import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { assertPortAllowed } from '../../../services/cmp-015-application-case/src/config.js';
import {
  assertSimulationPolicy,
  simulationMarkerOf,
} from '../../../services/cmp-018-inspection-verification/src/domain/simulation.js';
import { assertPortAllowed as assert027 } from '../../../services/cmp-027-grievance-feedback/src/config.js';
import { assertDigiLockerModeAllowed } from '../../../services/cmp-011-evidence-requirements/src/config.js';

const BINDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function expectCode(fn: () => void, code: string, detail?: string): void {
  try {
    fn();
    expect.fail(`expected ${code}`);
  } catch (err) {
    const e = err as { code?: string; details?: Array<{ code?: string }> | { code?: string } };
    expect(e.code).toBe(code);
    if (detail) {
      const details = Array.isArray(e.details) ? e.details : e.details ? [e.details] : [];
      expect(details.some((d) => d.code === detail) || String(err).includes(detail)).toBe(true);
    }
  }
}

describe('INT-013 M05 external dependency simulation (independent re-verify)', () => {
  it('CMP-015 SIMULATED ports refuse PRODUCTION; admit CI', () => {
    const sim = { simulation: 'SIMULATED' as const };
    expect(() => assertPortAllowed(sim, 'CI', 'DIGILOCKER')).not.toThrow();
    expectCode(
      () => assertPortAllowed(sim, 'PRODUCTION', 'DIGILOCKER'),
      'SF-SYS-003',
      'DIGILOCKER_PRODUCTION_SIMULATED_FORBIDDEN',
    );
    expectCode(
      () => assertPortAllowed(sim, 'UAT', 'DIGILOCKER'),
      'SF-SYS-003',
      'DIGILOCKER_SIMULATED_ENV_FORBIDDEN',
    );
  });

  it('CMP-018 critical SIMULATED refuse PRODUCTION; CI marker validates', () => {
    expect(() =>
      assertSimulationPolicy([
        { critical: true, mode: 'SIMULATED', environment: 'CI', connector_binding_id: BINDING },
      ]),
    ).not.toThrow();
    expectCode(
      () =>
        assertSimulationPolicy([
          {
            critical: true,
            mode: 'SIMULATED',
            environment: 'PRODUCTION',
            connector_binding_id: BINDING,
          },
        ]),
      'SF-INT-001',
      'CRITICAL_SIMULATED_IN_PRODUCTION',
    );
    const marker = simulationMarkerOf({
      critical: true,
      mode: 'SIMULATED',
      environment: 'CI',
      connector_binding_id: BINDING,
    });
    expect(validate('simulation-marker', marker).valid).toBe(true);
  });

  it('CMP-027 SIMULATED ports refuse PRODUCTION', () => {
    const sim = { simulation: 'SIMULATED' as const };
    expect(() => assert027(sim, 'CI', 'NOTIFY')).not.toThrow();
    expect(() => assert027(sim, 'PRODUCTION', 'NOTIFY')).toThrow();
  });

  it('CMP-011 DigiLocker SIMULATED PRODUCTION fail-closed (INT-006 dependency)', () => {
    expect(assertDigiLockerModeAllowed('SIMULATED', 'CI')).toBe('SIMULATED');
    expect(() => assertDigiLockerModeAllowed('SIMULATED', 'PRODUCTION')).toThrow();
  });
});
