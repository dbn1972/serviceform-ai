import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type ConnectorBinding } from '@serviceform/contracts';
import {
  assertBindingAllowed,
  simulatedBinding,
} from '../../../services/cmp-004-identity-access/src/bindings.js';
import { SimulatedOtpAdapter } from '../../../services/cmp-004-identity-access/src/adapters/otp.js';
import {
  assertBindingSafe,
  requireSimulationMarker,
} from '../../../services/cmp-005-citizen-profile/src/domain/connector-guard.js';

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/shared/examples/valid/connector-binding.local.json',
);

const OTP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T1 = '11111111-1111-4111-8111-111111111111';

function binding(overrides: Partial<ConnectorBinding> = {}): ConnectorBinding {
  const base = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ConnectorBinding;
  return {
    ...base,
    connector_type: 'DIGILOCKER',
    tenant_id: T1,
    ...overrides,
  };
}

describe('INT-013 M02 connector modes (independent; REAL/SANDBOX/SIMULATED)', () => {
  it('CMP-004 SIMULATED OTP is allowed in CI/LOCAL and emits a frozen marker', () => {
    const otpBind = simulatedBinding({
      id: OTP_ID,
      connector_type: 'OTP',
      environment: 'CI',
      simulator_version: 'otp-sim-1',
    });
    expect(() => assertBindingAllowed(otpBind, 'CI')).not.toThrow();
    expect(() => assertBindingAllowed(otpBind, 'LOCAL')).not.toThrow();
    const otp = new SimulatedOtpAdapter(otpBind, 'pepper');
    const minted = otp.createChallenge({
      challengeId: OTP_ID,
      channelHash: 'ab'.repeat(32),
      testRunId: 'm02-int',
    });
    expect(minted.simulation.simulation).toBe(true);
    expect(validate('simulation-marker', minted.simulation).valid).toBe(true);
    expect(validate('connector-binding', otpBind).valid).toBe(true);
  });

  it('CMP-004 refuses PRODUCTION SIMULATED and PRODUCTION environment SIMULATED', () => {
    const sim = simulatedBinding({
      id: OTP_ID,
      connector_type: 'OTP',
      simulator_version: 'otp-sim-1',
    });
    expect(() => assertBindingAllowed(sim, 'PRODUCTION')).toThrow();
    expect(() =>
      assertBindingAllowed({ ...sim, environment: 'PRODUCTION', mode: 'SIMULATED' }, 'CI'),
    ).toThrow();
    expect(() =>
      assertBindingAllowed(
        { ...sim, environment: 'PRODUCTION', mode: 'SIMULATED', critical: true },
        'PRODUCTION',
      ),
    ).toThrow();
  });

  it('CMP-005 SIMULATED DigiLocker is allowed in CI; PRODUCTION SIMULATED fail-closed', () => {
    const ci = binding({ environment: 'CI', mode: 'SIMULATED' });
    expect(() => assertBindingSafe(ci, 'CI', T1)).not.toThrow();
    const marker = requireSimulationMarker({
      environment: 'CI',
      scenario: 'happy',
      testRunId: 'm02-int',
      connectorBindingId: ci.connector_binding_id,
    });
    expect(marker.simulation).toBe(true);
    expect(validate('simulation-marker', marker).valid).toBe(true);
    expect(() =>
      assertBindingSafe(
        binding({ environment: 'PRODUCTION', mode: 'SIMULATED' }),
        'PRODUCTION',
        T1,
      ),
    ).toThrow();
  });

  it('CMP-005 REAL/SANDBOX bindings that mismatch environment fail closed', () => {
    expect(() =>
      assertBindingSafe(binding({ environment: 'CI', mode: 'REAL' }), 'PRODUCTION', T1),
    ).toThrow();
    expect(() =>
      assertBindingSafe(binding({ environment: 'LOCAL', mode: 'SANDBOX' }), 'CI', T1),
    ).toThrow();
    expect(() =>
      assertBindingSafe(binding({ environment: 'CI', mode: 'SIMULATED', tenant_id: T1 }), 'CI', T1),
    ).not.toThrow();
  });
});
