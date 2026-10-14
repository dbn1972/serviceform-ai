import { describe, expect, it } from 'vitest';
import {
  isErrorCode,
  isOpaqueRef,
  isScenario,
  isSha256Hex,
  isStorageKey,
} from '../../src/domain/charset.js';
import {
  assertForwardTransition,
  credentialIdFor,
  LIFECYCLE,
  type LifecycleStatus,
} from '../../src/domain/credential.js';
import { validateSigningResult } from '../../src/domain/signing.js';
import { isUuid } from '../../src/domain/uuid.js';
import { mapPgError } from '../../src/errors.js';
import type { SigningAdapterResult, SigningRequest } from '../../src/ports/signing-port.js';
import {
  APPLICATION_ID,
  BINDING_ID,
  ISSUANCE_KEY,
  simulatedFailed,
  simulatedSigned,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';

const REQ: SigningRequest = {
  credential_id: '22222222-2222-4222-8222-222222222222',
  artifact: { storage_key: 'k', sha256: 'a'.repeat(64) },
  attempt_number: 1,
  idempotency_key: 'cmp022.sign.x.1',
};

function signed(over: Partial<SigningAdapterResult> = {}): SigningAdapterResult {
  return { ...simulatedSigned(REQ), ...over };
}

const MARKER = simulatedSigned(REQ).simulation_marker as NonNullable<
  SigningAdapterResult['simulation_marker']
>;

function real(over: Partial<SigningAdapterResult> = {}): SigningAdapterResult {
  const { simulation_marker: _m, ...rest } = simulatedSigned(REQ);
  return { ...rest, connector_mode: 'REAL', ...over };
}

describe('forward-only lifecycle', () => {
  const allowed = new Set(['GENERATED>SIGNED', 'SIGNED>ISSUED']);
  for (const from of LIFECYCLE) {
    for (const to of LIFECYCLE) {
      const key = `${from}>${to}`;
      it(`${key} is ${allowed.has(key) ? 'allowed' : 'rejected'}`, () => {
        const run = (): void => assertForwardTransition(from as LifecycleStatus, to);
        if (allowed.has(key)) expect(run).not.toThrow();
        else expect(run).toThrow(expect.objectContaining({ code: 'SF-APP-001' }));
      });
    }
  }
});

describe('deterministic credential id', () => {
  it('is stable, tenant-scoped and a well-formed version-8 UUID', () => {
    const a = credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY);
    expect(credentialIdFor(TENANT_A, APPLICATION_ID, ISSUANCE_KEY)).toBe(a);
    expect(credentialIdFor(TENANT_B, APPLICATION_ID, ISSUANCE_KEY)).not.toBe(a);
    expect(credentialIdFor(TENANT_A, APPLICATION_ID, `${ISSUANCE_KEY}x`)).not.toBe(a);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('8');
    expect(['8', '9', 'a', 'b']).toContain(a[19]);
  });
});

describe('INT-013 signing result validation', () => {
  it('accepts SIMULATED with a matching marker in a simulation environment', () => {
    const v = validateSigningResult(signed(), 'CI');
    expect(v.signing_result).toBe('SIGNED');
    expect(v.simulation_marker?.environment).toBe('CI');
    expect(validateSigningResult(simulatedFailed(REQ), 'CI').failure_code).toBe('SF-CRED-001');
  });

  it.each(['UAT', 'PREPROD', 'PRODUCTION'] as const)('refuses SIMULATED in %s', (env) => {
    expect(() => validateSigningResult(signed(), env)).toThrow(
      expect.objectContaining({ code: 'SF-CRED-001' }),
    );
  });

  it.each(['REAL', 'SANDBOX'] as const)('accepts %s without a marker in PRODUCTION', (mode) => {
    expect(validateSigningResult(real({ connector_mode: mode }), 'PRODUCTION').connector_mode).toBe(
      mode,
    );
  });

  const bad: [string, SigningAdapterResult, string][] = [
    ['marker on REAL', real({ simulation_marker: MARKER }), 'SIMULATION_MARKER_FORBIDDEN'],
    [
      'SIMULATED without marker',
      { ...real(), connector_mode: 'SIMULATED' },
      'SIMULATION_MARKER_INVALID',
    ],
    [
      'marker for another binding',
      signed({
        simulation_marker: {
          ...MARKER,
          connector_binding_id: REQ.credential_id,
        },
      }),
      'SIMULATION_MARKER_INVALID',
    ],
    [
      'marker environment mismatch',
      signed({ simulation_marker: { ...MARKER, environment: 'SIT' } }),
      'SIMULATION_MARKER_INVALID',
    ],
    [
      'marker extra field',
      signed({ simulation_marker: { ...MARKER, extra: 1 } as never }),
      'SIMULATION_MARKER_INVALID',
    ],
    [
      'marker bad scenario',
      signed({ simulation_marker: { ...MARKER, scenario: 'Bad' } }),
      'SIMULATION_MARKER_INVALID',
    ],
    [
      'wrong integration contract',
      signed({ integration_contract: 'INT-012' as 'INT-013' }),
      'SIGNING_CONTRACT_MISMATCH',
    ],
    ['bad binding id', signed({ connector_binding_id: 'nope' }), 'SIGNING_RESULT_INVALID'],
    ['unknown mode', signed({ connector_mode: 'MOCK' as 'REAL' }), 'SIGNING_RESULT_INVALID'],
    [
      'SIGNED without hash',
      (({ signed_artifact_sha256: _s, ...rest }) => rest)(signed()),
      'SIGNING_RESULT_INVALID',
    ],
    ['SIGNED with bad ref', signed({ signature_ref: 'bad ref' }), 'SIGNING_RESULT_INVALID'],
    ['SIGNED with failure code', signed({ failure_code: 'SF-CRED-001' }), 'SIGNING_RESULT_INVALID'],
    [
      'FAILED with non-SF code',
      { ...simulatedFailed(REQ), failure_code: 'PROVIDER_42' },
      'SIGNING_RESULT_INVALID',
    ],
    [
      'FAILED with a signature',
      { ...simulatedFailed(REQ), signature_ref: 'x', signed_artifact_sha256: 'a'.repeat(64) },
      'SIGNING_RESULT_INVALID',
    ],
    ['unknown result', signed({ signing_result: 'MAYBE' as 'SIGNED' }), 'SIGNING_RESULT_INVALID'],
    [
      'bad provider ref',
      signed({ provider_transaction_ref: 'has space' }),
      'SIGNING_RESULT_INVALID',
    ],
  ];
  it.each(bad)('refuses %s', (_name, raw, code) => {
    let thrown: unknown;
    try {
      validateSigningResult(raw, 'CI');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'SF-CRED-001', details: [{ code }] });
  });

  it('the marker binding id is the fixture binding', () => {
    expect(signed().simulation_marker?.connector_binding_id).toBe(BINDING_ID);
  });
});

describe('charset checks', () => {
  it('mirror the frozen patterns', () => {
    expect(isOpaqueRef('app:1.2_3-x', 8, 128)).toBe(true);
    expect(isOpaqueRef('short', 8, 128)).toBe(false);
    expect(isOpaqueRef('a/b', 1, 128)).toBe(false);
    expect(isOpaqueRef(1, 1, 128)).toBe(false);
    expect(isStorageKey('tenant/a/b.pdf')).toBe(true);
    expect(isStorageKey('')).toBe(false);
    expect(isStorageKey('x'.repeat(513))).toBe(false);
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isErrorCode('SF-CRED-001')).toBe(true);
    expect(isErrorCode('SF-NOPE-001')).toBe(false);
    expect(isErrorCode('SF-CRED-01')).toBe(false);
    expect(isErrorCode('SF-CRED-0011')).toBe(false);
    expect(isErrorCode('XX-CRED-001')).toBe(false);
    expect(isScenario('esign_success')).toBe(true);
    expect(isScenario('e')).toBe(false);
    expect(isScenario('9abc')).toBe(false);
  });
});

describe('PostgreSQL error mapping', () => {
  it.each([
    ['42501', 'SF-TEN-002'],
    ['55000', 'SF-APP-001'],
    ['23505', 'SF-APP-002'],
    ['23503', 'SF-SYS-002'],
    ['23514', 'SF-SYS-003'],
    ['XX000', 'SF-SYS-001'],
  ])('%s maps to %s', (pg, code) => {
    expect(mapPgError(Object.assign(new Error('x'), { code: pg })).code).toBe(code);
  });
});
