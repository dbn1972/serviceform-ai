import { describe, expect, it } from 'vitest';
import { isValidTypeCode, wouldCycle, MAX_HIERARCHY_DEPTH } from '../../src/domain/hierarchy.js';
import { canonicalJson, requestFingerprint } from '../../src/domain/fingerprint.js';
import { isUuid } from '../../src/domain/uuid.js';
import { isForbiddenHeaderName } from '../../src/context.js';

describe('CMP-003 domain', () => {
  it('accepts configurable type codes without hard-coded level names', () => {
    expect(isValidTypeCode('LEVEL_A')).toBe(true);
    expect(isValidTypeCode('UNIT_9')).toBe(true);
    expect(isValidTypeCode('state')).toBe(false);
    expect(isValidTypeCode('District')).toBe(false);
  });

  it('detects hierarchy cycles and depth limits', () => {
    expect(
      wouldCycle({
        childId: 'a',
        parentId: 'b',
        ancestorsOfParent: ['b', 'a'],
        depthHitLimit: false,
      }).cycle,
    ).toBe(true);
    expect(
      wouldCycle({
        childId: 'a',
        parentId: 'b',
        ancestorsOfParent: ['b'],
        depthHitLimit: true,
      }).depthExceeded,
    ).toBe(true);
    expect(MAX_HIERARCHY_DEPTH).toBeGreaterThan(1);
  });

  it('fingerprints requests canonically', () => {
    const a = requestFingerprint('POST', '/v1/jurisdictions', { b: 1, a: 2 });
    const b = requestFingerprint('POST', '/v1/jurisdictions', { a: 2, b: 1 });
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
    expect(isUuid('11111111-1111-4111-8111-11111111111g')).toBe(false);
    expect(isUuid('11111111111141118111111111111111')).toBe(false);
  });
});
