import { describe, expect, it } from 'vitest';
import {
  isCurrencyCode,
  isLineCode,
  isRuleOutputKey,
  isSha256Prefixed,
} from '../../src/domain/charset.js';

const HEX64 = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

describe('linear charset checks match their documented patterns', () => {
  it.each([
    ['A', true],
    ['BASE_FEE', true],
    ['X.Y-Z_9', true],
    ['A'.repeat(64), true],
    ['A'.repeat(65), false],
    ['', false],
    ['base', false],
    ['A B', false],
    ['É', false],
    ['A/B', false],
  ])('isLineCode(%j) = %s  /^[A-Z0-9_.-]{1,64}$/', (v, expected) => {
    expect(isLineCode(v)).toBe(expected);
  });

  it.each([
    ['a', true],
    ['line_amount_minor', true],
    ['Out.v2', true],
    ['a'.repeat(64), true],
    ['a'.repeat(65), false],
    ['', false],
    ['9a', false],
    ['_a', false],
    ['a-b', false],
    ['a b', false],
  ])('isRuleOutputKey(%j) = %s  /^[A-Za-z][A-Za-z0-9_.]{0,63}$/', (v, expected) => {
    expect(isRuleOutputKey(v)).toBe(expected);
  });

  it.each([
    ['XTS', true],
    ['ABC', true],
    ['AB', false],
    ['ABCD', false],
    ['abc', false],
    ['A1C', false],
    ['', false],
  ])('isCurrencyCode(%j) = %s  /^[A-Z]{3}$/', (v, expected) => {
    expect(isCurrencyCode(v)).toBe(expected);
  });

  it.each([
    [`sha256:${HEX64}`, true],
    [`sha256:${HEX64.toUpperCase()}`, false],
    [`sha256:${HEX64}0`, false],
    [`sha256:${HEX64.slice(1)}`, false],
    [`md5:${HEX64}`, false],
    [`sha256:${'g'.repeat(64)}`, false],
    ['', false],
  ])('isSha256Prefixed(%j) = %s  /^sha256:[0-9a-f]{64}$/', (v, expected) => {
    expect(isSha256Prefixed(v)).toBe(expected);
  });
});
