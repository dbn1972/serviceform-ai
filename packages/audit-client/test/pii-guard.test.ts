import { describe, expect, it } from 'vitest';
import { assertNoPii, canonicalJson, PiiRejectedError } from '../src/index.js';

describe('pii-guard', () => {
  it('rejects Aadhaar variants in free text (003-24, 003-25)', () => {
    const samples = [
      '499118665246',
      '4991 1866 5246',
      '4991-1866-5246',
      '４９９１１８６６５２４６',
      '4\u200d99118665246',
      '४९९११८६६५२४६',
    ];
    for (const s of samples) {
      expect(() => assertNoPii('/reason', `note ${s}`)).toThrow(PiiRejectedError);
    }
  });

  it('rejects PAN, email evasions and mobile', () => {
    expect(() => assertNoPii('/reason', 'ABCDE1234F')).toThrow(PiiRejectedError);
    expect(() => assertNoPii('/reason', 'abcde1234f')).toThrow(PiiRejectedError);
    expect(() => assertNoPii('/reason', 'a%40b.in')).toThrow(PiiRejectedError);
    expect(() => assertNoPii('/reason', 'a [at] b.in')).toThrow(PiiRejectedError);
    expect(() => assertNoPii('/reason', '9876543210')).toThrow(PiiRejectedError);
  });

  it('rejects NUL', () => {
    expect(() => assertNoPii('/reason', 'ok\u0000x')).toThrow(PiiRejectedError);
  });

  it('allows a synthetic reason without identifiers', () => {
    expect(() => assertNoPii('/reason', 'Synthetic example reason')).not.toThrow();
  });
});

describe('canonicalJson', () => {
  it('sorts keys independently of insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});
