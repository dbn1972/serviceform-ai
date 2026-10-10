/**
 * Exact money in integer minor units. Values are carried as bigint and only converted to a JS
 * number at the contract boundary after a safe-integer check; floating point never participates.
 */
export const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

const MINOR_STRING = /^(0|[1-9][0-9]{0,15})$/;

/** Accepts a non-negative safe integer or its canonical decimal string; anything else is null. */
export function parseMinor(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return null;
    return BigInt(value);
  }
  if (typeof value === 'bigint') return value >= 0n && value <= MAX_MINOR ? value : null;
  if (typeof value === 'string' && MINOR_STRING.test(value)) {
    const parsed = BigInt(value);
    return parsed <= MAX_MINOR ? parsed : null;
  }
  return null;
}

export function sumMinor(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function isWithinContractRange(value: bigint): boolean {
  return value >= 0n && value <= MAX_MINOR;
}

export function toContractInteger(value: bigint): number {
  if (!isWithinContractRange(value)) throw new RangeError('minor amount outside contract range');
  return Number(value);
}
