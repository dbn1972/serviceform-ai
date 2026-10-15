import { describe, expect, it } from 'vitest';
import { canonicalJson, requestFingerprint, IDEMPOTENCY_KEY } from '../../src/domain/fingerprint.js';
import { isUuid } from '../../src/domain/uuid.js';

describe('CMP-058 domain utilities', () => {
  describe('canonicalJson', () => {
    it('sorts object keys deterministically', () => {
      const a = canonicalJson({ z: 1, a: 2 });
      const b = canonicalJson({ a: 2, z: 1 });
      expect(a).toBe(b);
    });

    it('handles nested objects and arrays', () => {
      expect(canonicalJson({ a: [1, 2], b: { c: null } })).toBe('{"a":[1,2],"b":{"c":null}}');
    });
  });

  describe('requestFingerprint', () => {
    it('is deterministic for same input', () => {
      const fp1 = requestFingerprint('POST', '/v1/elements', { key: 'val' });
      const fp2 = requestFingerprint('POST', '/v1/elements', { key: 'val' });
      expect(fp1).toBe(fp2);
    });

    it('differs for different body', () => {
      const fp1 = requestFingerprint('POST', '/v1/elements', { key: 'a' });
      const fp2 = requestFingerprint('POST', '/v1/elements', { key: 'b' });
      expect(fp1).not.toBe(fp2);
    });

    it('starts with sha256:', () => {
      expect(requestFingerprint('GET', '/v1/elements', null)).toMatch(/^sha256:/);
    });
  });

  describe('IDEMPOTENCY_KEY pattern', () => {
    it('accepts valid keys', () => {
      expect(IDEMPOTENCY_KEY.test('idem-test-0001')).toBe(true);
      expect(IDEMPOTENCY_KEY.test('abc12345')).toBe(true);
    });

    it('rejects too short keys', () => {
      expect(IDEMPOTENCY_KEY.test('short')).toBe(false);
    });
  });

  describe('isUuid', () => {
    it('accepts valid UUID v4', () => {
      expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    });

    it('rejects non-uuid', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
      expect(isUuid(123)).toBe(false);
    });
  });
});
