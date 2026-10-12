import { Cmp021Error, detail } from '../errors.js';

/** Integer minor units only. Never floating point. */
export function toMinor(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Cmp021Error('SF-SYS-001', detail('INVALID_AMOUNT_MINOR'));
}

export function assertNonNegative(amount: bigint): void {
  if (amount < 0n) throw new Cmp021Error('SF-PAY-001', detail('AMOUNT_NEGATIVE'));
}
