import { describe, expect, it } from 'vitest';
import {
  isHandleRef,
  isLocale,
  isParamName,
  isSecretRef,
  isTemplateRef,
} from '../../src/domain/model.js';
import { validateDispatchInput } from '../../src/service/input.js';
import { assertBindingPolicy, isSimulationMarker } from '../../src/domain/simulation.js';
import { BINDING_SMS, realBinding, TENANT_A } from '../doubles/fixtures.js';

/**
 * Truth table recorded from the previous regular-expression implementations (and the frozen schema
 * pattern for secret references): [sample, templateRef, handleRef, locale, paramName, secretRef].
 */
const TRUTH: [string, boolean, boolean, boolean, boolean, boolean][] = [
  ['', false, false, false, false, false],
  ['a', true, false, false, true, false],
  ['ab', true, false, true, true, false],
  ['en', true, false, true, true, false],
  ['en-IN', true, false, true, false, false],
  ['en-in', true, false, false, false, false],
  ['EN-IN', true, false, false, false, false],
  ['en_IN', true, false, false, false, false],
  ['en-INN', true, false, false, false, false],
  ['eng', true, false, false, true, false],
  ['tpl.payment.received.v1', true, true, false, false, false],
  ['handle.citizen.demo.001', true, true, false, false, false],
  ['short', true, false, false, true, false],
  ['1234567', true, false, false, false, false],
  ['12345678', true, true, false, false, false],
  ['a b', false, false, false, false, false],
  ['a/b', false, false, false, false, false],
  ['tpl\n', false, false, false, false, false],
  ['tplé', false, false, false, false, false],
  ['Aaaa', true, false, false, false, false],
  ['a_1', true, false, false, true, false],
  ['_a', true, false, false, false, false],
  ['1a', true, false, false, false, false],
  ['a'.repeat(63), true, true, false, true, false],
  ['a'.repeat(64), true, true, false, true, false],
  ['a'.repeat(65), true, true, false, false, false],
  ['a'.repeat(127), true, true, false, false, false],
  ['a'.repeat(128), true, true, false, false, false],
  ['a'.repeat(129), false, false, false, false, false],
  ['aws-sm://x', false, false, false, false, true],
  ['aws-sm://', false, false, false, false, false],
  ['aws-ssm://sf/test/ref', false, false, false, false, true],
  ['vault://a/b=c+d@e-f.g_h', false, false, false, false, true],
  ['vault:/x', false, false, false, false, false],
  ['aws-sm:// x', false, false, false, false, false],
  ['AWS-SM://x', false, false, false, false, false],
  ['gcp-sm://x', false, false, false, false, false],
  ['aws-sm://x\n', false, false, false, false, false],
  ['ssm://x', false, false, false, false, false],
];

describe('linear validators agree with the previous patterns', () => {
  it.each(TRUTH)('sample %j', (sample, template, handle, locale, param, secret) => {
    expect(isTemplateRef(sample)).toBe(template);
    expect(isHandleRef(sample)).toBe(handle);
    expect(isLocale(sample)).toBe(locale);
    expect(isParamName(sample)).toBe(param);
    expect(isSecretRef(sample)).toBe(secret);
  });

  it('secret refs over the 512 character bound are refused (stricter than the frozen schema, fail-closed)', () => {
    const long = `vault://${'a'.repeat(504)}`;
    expect(long).toHaveLength(512);
    expect(isSecretRef(long)).toBe(true);
    expect(isSecretRef(`${long}a`)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 1, {}, [], true]) {
      expect(isTemplateRef(v)).toBe(false);
      expect(isHandleRef(v)).toBe(false);
      expect(isLocale(v)).toBe(false);
      expect(isParamName(v)).toBe(false);
      expect(isSecretRef(v)).toBe(false);
    }
  });
});

describe('hostile input is bounded and linear', () => {
  const hostile = [
    `${'a'.repeat(5_000_000)}!`,
    `${'-'.repeat(5_000_000)}\n`,
    `vault://${'/'.repeat(5_000_000)}!`,
    `${'a'.repeat(100_000)}${' '.repeat(100_000)}x`,
  ];

  it('validators answer immediately on multi-megabyte input', () => {
    const t0 = performance.now();
    for (const h of hostile) {
      expect(isTemplateRef(h)).toBe(false);
      expect(isHandleRef(h)).toBe(false);
      expect(isLocale(h)).toBe(false);
      expect(isParamName(h)).toBe(false);
      expect(isSecretRef(h)).toBe(false);
    }
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it('dispatch input validation and binding policy refuse hostile values quickly and fail closed', () => {
    const t0 = performance.now();
    for (const h of hostile) {
      expect(() =>
        validateDispatchInput({
          template_ref: h,
          channel: 'SMS',
          locale: 'en-IN',
          recipient_handle_class: 'CITIZEN_HANDLE_REF',
          recipient_handle_ref: 'handle.demo.0001',
          connector_binding_id: BINDING_SMS,
        }),
      ).toThrow();
      expect(() =>
        validateDispatchInput({
          template_ref: 'tpl.a',
          channel: 'SMS',
          locale: h,
          recipient_handle_class: 'CITIZEN_HANDLE_REF',
          recipient_handle_ref: h,
          connector_binding_id: BINDING_SMS,
        }),
      ).toThrow();
      expect(() =>
        assertBindingPolicy(realBinding({ environment: 'UAT', secret_ref: h }), {
          tenantId: TENANT_A,
          channel: 'SMS',
          runtimeEnvironment: 'UAT',
        }),
      ).toThrow();
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('marker validation bounds the scenario length first', () => {
    const marker = {
      simulation: true,
      scenario: `n${'a'.repeat(5_000_000)}!`,
      test_run_id: 'r',
      connector_binding_id: BINDING_SMS,
      environment: 'CI',
    };
    const t0 = performance.now();
    expect(isSimulationMarker(marker)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
