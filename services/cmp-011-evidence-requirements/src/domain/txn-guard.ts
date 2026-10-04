import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp011Error } from '../errors.js';

const txnAls = new AsyncLocalStorage<{ depth: number }>();

export function isTransactionOpen(): boolean {
  return (txnAls.getStore()?.depth ?? 0) > 0;
}

export function assertNoOpenTransaction(): void {
  if (isTransactionOpen()) {
    throw new Cmp011Error('SF-SYS-001', { details: [{ code: 'OUTBOUND_IN_TX' }] });
  }
}

export function runWithTxnFlag<T>(fn: () => Promise<T>): Promise<T> {
  const depth = (txnAls.getStore()?.depth ?? 0) + 1;
  return txnAls.run({ depth }, fn);
}
