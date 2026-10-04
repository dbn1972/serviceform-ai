import { describe, expect, it } from 'vitest';
import { isCategoryCode, isSlugCode, isTag } from '../../src/domain/codes.js';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';
import { isUuid } from '../../src/domain/uuid.js';
import { isForbiddenHeaderName } from '../../src/context.js';
import { assertUnpublished, rejectClientPin } from '../../src/domain/publication.js';
import { assertSimulationPolicy } from '../../src/domain/simulation.js';
import { Cmp001Error } from '../../src/errors.js';

describe('CMP-001 domain', () => {
  it('accepts generic codes without named geography or services', () => {
    expect(isCategoryCode('FAMILY_A')).toBe(true);
    expect(isCategoryCode('state')).toBe(false);
    expect(isSlugCode('svc-alpha')).toBe(true);
    expect(isSlugCode('ResidenceCertificate')).toBe(false);
    expect(isTag('civil-docs')).toBe(true);
    expect(isTag('West Bengal')).toBe(false);
  });

  it('fingerprints requests canonically', () => {
    const a = requestFingerprint('POST', '/v1/offerings', { b: 1, a: 2 });
    const b = requestFingerprint('POST', '/v1/offerings', { a: 2, b: 1 });
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

  it('refuses published-pin mutation and client tenant fields', () => {
    expect(() => assertUnpublished('pin-1')).toThrow(Cmp001Error);
    expect(() => rejectClientPin({ tenant_id: 'x' })).toThrow(Cmp001Error);
    expect(() => rejectClientPin({ published_pin_ref: 'p' })).toThrow(Cmp001Error);
    expect(() => rejectClientPin({ local_name: 'n' })).not.toThrow();
  });

  it('INT-013 fail-closed on production critical SIMULATED', () => {
    expect(() =>
      assertSimulationPolicy([{ critical: true, mode: 'SIMULATED', environment: 'PRODUCTION' }]),
    ).toThrow(Cmp001Error);
    expect(() =>
      assertSimulationPolicy([{ critical: true, mode: 'SIMULATED', environment: 'LOCAL' }]),
    ).not.toThrow();
  });
});
