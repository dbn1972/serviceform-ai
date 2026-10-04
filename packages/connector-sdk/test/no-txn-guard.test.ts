import { describe, expect, it } from 'vitest';
import {
  OutboundCallInTransactionError,
  assertNoOpenTransaction,
  isTransactionOpen,
  runInTransaction,
} from '../src/index.js';

describe('no-txn guard', () => {
  it('throws inside withTransaction and is clean outside, including nested promises', async () => {
    expect(isTransactionOpen()).toBe(false);
    assertNoOpenTransaction();
    await expect(
      runInTransaction(async () => {
        expect(isTransactionOpen()).toBe(true);
        assertNoOpenTransaction();
      }),
    ).rejects.toBeInstanceOf(OutboundCallInTransactionError);
    await runInTransaction(async () => {
      await Promise.resolve();
      expect(isTransactionOpen()).toBe(true);
    }).catch(() => undefined);
    expect(isTransactionOpen()).toBe(false);
  });
});
