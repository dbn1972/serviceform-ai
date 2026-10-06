import { AsyncLocalStorage } from 'node:async_hooks';
import { Cmp027Error } from './errors.js';

const scope = new AsyncLocalStorage<{ open: true }>();

export function inDomainTransaction(): boolean {
  return scope.getStore()?.open === true;
}

export function runInDomainTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ open: true }, fn);
}

export function assertNoOpenDomainTransaction(port: string): void {
  if (inDomainTransaction()) {
    throw new Cmp027Error('SF-SYS-001', {
      details: [
        {
          code: 'NETWORK_IO_IN_DOMAIN_TX',
          message: `outbound port ${port} called inside the domain transaction`,
        },
      ],
    });
  }
}

export function guardOutboundPort<T extends object>(name: string, port: T): T {
  return new Proxy(port, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        assertNoOpenDomainTransaction(name);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
