import { describe, expect, it } from 'vitest';
import { isValidSetCode, isValidValueCode, parseVersionNo } from '../../src/domain/codes.js';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';
import { isUuid } from '../../src/domain/uuid.js';
import { isForbiddenHeaderName } from '../../src/context.js';
import { assertConnectorImportSafe } from '../../src/domain/import-binding.js';
import { localSimulatedBinding } from '../doubles/connector-example.js';

const simBinding = localSimulatedBinding({
  tenant_id: '11111111-1111-4111-8111-111111111111',
});

describe('CMP-034 domain', () => {
  it('accepts generic set/value codes without named-service branching', () => {
    expect(isValidSetCode('GENERIC_SET')).toBe(true);
    expect(isValidSetCode('residence_certificate')).toBe(false);
    expect(isValidValueCode('ITEM_A')).toBe(true);
    expect(isValidValueCode('item-a')).toBe(false);
    expect(parseVersionNo('2')).toBe(2);
    expect(Number.isNaN(parseVersionNo('0'))).toBe(true);
  });

  it('fingerprints requests canonically', () => {
    const a = requestFingerprint('POST', '/v1/code-sets', { b: 1, a: 2 });
    const b = requestFingerprint('POST', '/v1/code-sets', { a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
    expect(canonicalJson({ z: 1, a: null })).toBe('{"a":null,"z":1}');
  });

  it('rejects tenant-identifying headers', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('X-SF-Actor')).toBe(true);
    expect(isForbiddenHeaderName('authorization')).toBe(false);
  });

  it('validates UUID shape without ambiguous regex quantifiers', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });

  it('INT-013 fail-closed: PRODUCTION SIMULATED import binding is refused', () => {
    expect(() =>
      assertConnectorImportSafe(
        { ...simBinding, environment: 'PRODUCTION', mode: 'SIMULATED' },
        'PRODUCTION',
      ),
    ).toThrow();
    const allowed = assertConnectorImportSafe(simBinding, 'LOCAL');
    expect(allowed.mode).toBe('SIMULATED');
  });
});
