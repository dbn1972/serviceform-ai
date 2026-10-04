import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ConnectorBinding } from '@serviceform/contracts';
import { assertBindingAllowed, simulatedBinding } from '../../src/bindings.js';
import { SimulatedOtpAdapter } from '../../src/adapters/otp.js';
import { SimulatedIdpAdapter, mintSimulatedIdpAssertion } from '../../src/adapters/idp.js';
import { SimulatedDigiLockerIdentityAdapter } from '../../src/adapters/digilocker.js';
import { Cmp004Error } from '../../src/errors.js';
import { authorize, denyAllAuthorization } from '../../src/authz.js';
import { assertNoTenantIdentifyingHeaders, isForbiddenHeaderName } from '../../src/context.js';
import { hmacHex, sha256Hex, fingerprintRequest } from '../../src/hashing.js';

const OTP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T1 = '11111111-1111-4111-8111-111111111111';
const OFFICER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('INT-013 fail-closed adapters', () => {
  it('refuses PRODUCTION SIMULATED critical bindings', () => {
    const binding: ConnectorBinding = {
      connector_binding_id: OTP_ID,
      tenant_id: null,
      connector_type: 'OTP',
      mode: 'SIMULATED',
      environment: 'LOCAL',
      critical: true,
      secret_ref: null,
      simulator_version: 'otp-sim-1',
    };
    expect(() => assertBindingAllowed(binding, 'PRODUCTION')).toThrow(Cmp004Error);
    const prodSim = {
      ...binding,
      environment: 'PRODUCTION' as const,
      mode: 'SIMULATED' as const,
    };
    expect(() => assertBindingAllowed(prodSim, 'CI')).toThrow(Cmp004Error);
  });

  it('accepts SIMULATED in CI and mints deterministic OTP/IdP/DigiLocker results', async () => {
    const otpBind = simulatedBinding({
      id: OTP_ID,
      connector_type: 'OTP',
      simulator_version: 'otp-sim-1',
    });
    assertBindingAllowed(otpBind, 'CI');
    const otp = new SimulatedOtpAdapter(otpBind, 'pepper');
    const a = otp.createChallenge({
      challengeId: OTP_ID,
      channelHash: 'ab'.repeat(32),
      testRunId: 't',
    });
    const b = otp.createChallenge({
      challengeId: OTP_ID,
      channelHash: 'ab'.repeat(32),
      testRunId: 't',
    });
    expect(a.code).toBe(b.code);
    expect(a.simulation.simulation).toBe(true);
    await otp.dispatch({ challengeId: OTP_ID, channelHash: 'ab'.repeat(32) });

    const assertion = mintSimulatedIdpAssertion('pepper', {
      sub: 's',
      tenant_id: T1,
      officer_id: OFFICER,
      roles: ['SERVICE_CHECKER'],
    });
    const idp = new SimulatedIdpAdapter(
      simulatedBinding({
        id: IDP_ID,
        connector_type: 'DEPARTMENT_API',
        simulator_version: 'idp-sim-1',
      }),
      'pepper',
    );
    const claims = idp.verifyAssertion(assertion, 't');
    expect(claims.tenant_id).toBe(T1);
    expect(() => idp.verifyAssertion('not-valid', 't')).toThrow(Cmp004Error);

    const dl = new SimulatedDigiLockerIdentityAdapter(
      simulatedBinding({ id: DL_ID, connector_type: 'DIGILOCKER', simulator_version: 'dl-sim-1' }),
      'pepper',
    );
    const linked = await dl.exchangeAuthorizationCode({
      code: 'sim-code-ok',
      citizenId: randomUUID(),
      testRunId: 't',
    });
    expect(linked.subjectHash).toHaveLength(64);
    await expect(
      dl.exchangeAuthorizationCode({ code: 'short', citizenId: randomUUID(), testRunId: 't' }),
    ).rejects.toBeInstanceOf(Cmp004Error);
  });
});

describe('authz and headers', () => {
  it('fail-closes authorization and blocks tenant headers', async () => {
    await expect(
      authorize(denyAllAuthorization, {
        subject: {
          user_id: OFFICER,
          actor_type: 'OFFICER',
          tenant_id: T1,
          roles: ['SERVICE_CHECKER'],
          jurisdiction_ids: [],
        },
        resource: {
          resource_type: 'OfficerSession',
          tenant_id: T1,
          classification: 'TENANT_SCOPED',
        },
        action: 'OFFICER_SESSION_ISSUE',
      }),
    ).rejects.toMatchObject({ code: 'SF-AUTH-002' });
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('x-sf-roles')).toBe(true);
    expect(() =>
      assertNoTenantIdentifyingHeaders({
        headers: { forwarded: 'for=1;tenant=abc' },
      } as never),
    ).toThrow(Cmp004Error);
  });

  it('hashes without embedding raw channel material in fingerprints of objects', () => {
    expect(sha256Hex('a')).toHaveLength(64);
    expect(hmacHex('p', 'v')).toHaveLength(64);
    expect(fingerprintRequest({ channel_hash: 'ab' })).toMatch(/^sha256:/);
  });
});
