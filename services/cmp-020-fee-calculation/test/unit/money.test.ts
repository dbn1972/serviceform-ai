import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isWithinContractRange,
  MAX_MINOR,
  parseMinor,
  sumMinor,
  toContractInteger,
} from '../../src/domain/money.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

describe('exact money (integer minor units)', () => {
  it('accepts non-negative safe integers and canonical integer strings', () => {
    expect(parseMinor(0)).toBe(0n);
    expect(parseMinor(12345)).toBe(12345n);
    expect(parseMinor('0')).toBe(0n);
    expect(parseMinor('678')).toBe(678n);
    expect(parseMinor(Number.MAX_SAFE_INTEGER)).toBe(MAX_MINOR);
    expect(parseMinor(String(Number.MAX_SAFE_INTEGER))).toBe(MAX_MINOR);
    expect(parseMinor(5n)).toBe(5n);
  });

  it.each([
    ['fraction', 12.5],
    ['tiny fraction', 0.1 + 0.2],
    ['negative', -1],
    ['negative zero', -0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['decimal string', '12.50'],
    ['exponent string', '1e3'],
    ['leading zero', '0100'],
    ['signed string', '+5'],
    ['negative string', '-5'],
    ['whitespace', ' 5'],
    ['too large string', '90071992547409920'],
    ['negative bigint', -1n],
    ['oversized bigint', MAX_MINOR + 1n],
    ['boolean', true],
    ['null', null],
    ['object', { amount: 1 }],
  ])('refuses %s instead of coercing', (_label, value) => {
    expect(parseMinor(value)).toBeNull();
  });

  it('sums exactly beyond float precision and range-checks at the contract boundary', () => {
    const big = MAX_MINOR - 1n;
    expect(sumMinor([big, 1n])).toBe(MAX_MINOR);
    expect(isWithinContractRange(sumMinor([big, 2n]))).toBe(false);
    expect(() => toContractInteger(MAX_MINOR + 1n)).toThrow(RangeError);
    expect(() => toContractInteger(-1n)).toThrow(RangeError);
    expect(toContractInteger(MAX_MINOR)).toBe(Number.MAX_SAFE_INTEGER);
    // The float sum differs; the exact sum must not.
    expect(sumMinor([10n, 20n])).toBe(30n);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('production source never uses floating-point money operations', () => {
    const forbidden =
      /parseFloat|toFixed|toPrecision|Math\.(round|floor|ceil|trunc)|Number\.parseFloat/;
    const offenders = sourceFiles(srcDir).filter((f) => forbidden.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('production source carries no currency literal or fee table', () => {
    const currencyLiteral = /['"`](INR|USD|EUR|GBP)['"`]/;
    const offenders = sourceFiles(srcDir).filter((f) =>
      currencyLiteral.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
