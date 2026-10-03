import { AsyncLocalStorage } from 'node:async_hooks';
import { OutboundCallInTransactionError } from './errors.js';

export interface TransactionStore {
  depth: number;
}

export const transactionContext = new AsyncLocalStorage<TransactionStore>();

export function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const parent = transactionContext.getStore();
  const depth = (parent?.depth ?? 0) + 1;
  return transactionContext.run({ depth }, fn);
}

export function isTransactionOpen(): boolean {
  return (transactionContext.getStore()?.depth ?? 0) > 0;
}

export function assertNoOpenTransaction(): void {
  if (isTransactionOpen()) throw new OutboundCallInTransactionError();
}
