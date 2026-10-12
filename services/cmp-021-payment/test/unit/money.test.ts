import { describe, expect, it } from 'vitest';
import { toMinor, assertNonNegative } from '../../src/domain/money.js';
import { Cmp021Error } from '../../src/errors.js';

describe('money domain', () => {
  it('converts integer number to bigint', () => {
    expect(toMinor(1000)).toBe(1000n);
  });

  it('converts bigint identity', () => {
    expect(toMinor(500n)).toBe(500n);
  });

  it('converts numeric string', () => {
    expect(toMinor('12345')).toBe(12345n);
  });

  it('throws on fractional number', () => {
    expect(() => toMinor(1.5)).toThrow(Cmp021Error);
  });

  it('throws on negative number', () => {
    expect(() => toMinor(-1)).toThrow(Cmp021Error);
  });

  it('assertNonNegative passes for zero', () => {
    expect(() => assertNonNegative(0n)).not.toThrow();
  });

  it('assertNonNegative throws for negative', () => {
    expect(() => assertNonNegative(-1n)).toThrow(Cmp021Error);
  });
});
