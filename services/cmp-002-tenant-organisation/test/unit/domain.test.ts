import { describe, expect, it } from 'vitest';
import { wouldCycle } from '../../src/domain/hierarchy.js';
import {
  canonicalJson,
  IDEMPOTENCY_KEY,
  requestFingerprint,
} from '../../src/domain/fingerprint.js';
import { isForbiddenHeaderName, forwardedCarriesTenant } from '../../src/context.js';
import { Cmp002Error, mapPgError } from '../../src/errors.js';

describe('hierarchy cycle detector', () => {
  it('detects self-parent and ancestor cycles', () => {
    expect(
      wouldCycle({ childId: 'a', parentId: 'a', ancestorsOfParent: [], depthHitLimit: false })
        .cycle,
    ).toBe(true);
    expect(
      wouldCycle({
        childId: 'a',
        parentId: 'b',
        ancestorsOfParent: ['a', 'b'],
        depthHitLimit: false,
      }).cycle,
    ).toBe(true);
    expect(
      wouldCycle({ childId: 'a', parentId: 'b', ancestorsOfParent: ['c'], depthHitLimit: false })
        .cycle,
    ).toBe(false);
    expect(
      wouldCycle({ childId: 'a', parentId: null, ancestorsOfParent: ['a'], depthHitLimit: false })
        .cycle,
    ).toBe(false);
    expect(
      wouldCycle({ childId: 'a', parentId: 'b', ancestorsOfParent: [], depthHitLimit: true })
        .depthExceeded,
    ).toBe(true);
  });
});

describe('fingerprint', () => {
  it('is stable for key-reordered bodies', () => {
    const a = requestFingerprint('POST', '/v1/organisations', { b: 1, a: 2 });
    const b = requestFingerprint('POST', '/v1/organisations', { a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
    expect(canonicalJson({ z: 1, a: { c: 2, b: 3 } })).toBe('{"a":{"b":3,"c":2},"z":1}');
    expect(IDEMPOTENCY_KEY.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY.test('idem-key-01')).toBe(true);
  });
});

describe('header guard', () => {
  it('refuses tenant and spoofed role headers', () => {
    expect(isForbiddenHeaderName('x-tenant-id')).toBe(true);
    expect(isForbiddenHeaderName('X-SF-Tenant-Id')).toBe(true);
    expect(isForbiddenHeaderName('x-sf-actor-type')).toBe(true);
    expect(isForbiddenHeaderName('x-roles')).toBe(true);
    expect(isForbiddenHeaderName('x-correlation-id')).toBe(false);
    expect(forwardedCarriesTenant('for=1.1.1.1;tenant=abc')).toBe(true);
    expect(forwardedCarriesTenant('for=1.1.1.1')).toBe(false);
  });
});

describe('error mapping', () => {
  it('maps catalogue failures without SQL text', () => {
    const e = mapPgError({ code: '42501', message: 'permission denied for table office' });
    expect(e).toBeInstanceOf(Cmp002Error);
    expect(e.code).toBe('SF-TEN-002');
    expect(e.message).not.toMatch(/office|sql/i);
    expect(mapPgError({ code: '23505' }).code).toBe('SF-APP-002');
    expect(mapPgError({ code: '23503' }).code).toBe('SF-SYS-002');
  });
});
