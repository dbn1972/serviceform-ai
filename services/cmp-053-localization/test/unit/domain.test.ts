import { describe, expect, it } from 'vitest';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';
import { formatDecimal, formatIsoDate } from '../../src/domain/format.js';
import { fallbackChain, fallbackCycle, isLocaleTag, parentTag } from '../../src/domain/locale.js';
import { isForbiddenHeaderName } from '../../src/context.js';
import { assertAssistBindingSafe } from '../../src/ports/assist.js';
import type { ConnectorBinding } from '@serviceform/contracts';
import { Cmp053Error } from '../../src/errors.js';

const profile = {
  date_skeleton: 'yyyyMMdd',
  time_skeleton: 'HHmm',
  decimal_separator: ',',
  group_separator: ' ',
};

describe('CMP-053 domain', () => {
  it('accepts generic locale tags without named language/jurisdiction lists', () => {
    expect(isLocaleTag('xx')).toBe(true);
    expect(isLocaleTag('xx-YY')).toBe(true);
    expect(isLocaleTag('EN')).toBe(false);
    expect(isLocaleTag('xx_YY')).toBe(false);
  });

  it('builds fallback chain requested -> configured -> parents -> default', () => {
    expect(
      fallbackChain({
        requested: 'aa-BB-CC',
        configuredFallback: 'zz',
        defaultTag: 'aa',
      }),
    ).toEqual(['aa-BB-CC', 'zz', 'aa-BB', 'aa']);
  });

  it('detects configured fallback cycles', () => {
    expect(parentTag('aa-BB')).toBe('aa');
    expect(
      fallbackCycle(
        'aa',
        new Map([
          ['aa', 'bb'],
          ['bb', 'aa'],
        ]),
      ),
    ).toBe(true);
    expect(
      fallbackCycle(
        'aa',
        new Map([
          ['aa', 'bb'],
          ['bb', null],
        ]),
      ),
    ).toBe(false);
  });

  it('formats numbers and dates from stored profiles only', () => {
    expect(formatDecimal(profile, '1234.5')).toBe('1 234,5');
    expect(formatIsoDate(profile, '2026-10-04')).toBe('20261004');
    expect(() => formatDecimal(profile, 'not-a-number')).toThrow(Cmp053Error);
  });

  it('fingerprints requests canonically', () => {
    const a = requestFingerprint('POST', '/v1/catalogs', { b: 1, a: 2 });
    const b = requestFingerprint('POST', '/v1/catalogs', { a: 2, b: 1 });
    expect(a).toBe(b);
    expect(canonicalJson({ z: 1, a: null })).toBe('{"a":null,"z":1}');
  });

  it('rejects tenant-identifying headers', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('X-SF-Actor')).toBe(true);
    expect(isForbiddenHeaderName('authorization')).toBe(false);
  });

  it('refuses SIMULATED assist bindings in production (INT-013 fail-closed)', () => {
    const binding: ConnectorBinding = {
      connector_binding_id: 'd17e5fc0-28e4-4b6a-b9d1-04cfa0e28d5d',
      tenant_id: null,
      connector_type: 'DEPARTMENT_API',
      mode: 'SIMULATED',
      environment: 'LOCAL',
      critical: false,
      secret_ref: null,
      simulator_version: 'loc-1.0.0',
    };
    expect(() => assertAssistBindingSafe('PRODUCTION', binding)).toThrow(Cmp053Error);
    expect(() => assertAssistBindingSafe('LOCAL', binding)).not.toThrow();
  });
});
