import { CircuitOpenError } from './errors.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  windowMs: number;
  openMs: number;
}

export const DEFAULT_CIRCUIT_POLICY: CircuitBreakerPolicy = {
  failureThreshold: 5,
  windowMs: 30_000,
  openMs: 30_000,
};

interface Breaker {
  state: CircuitState;
  failures: number[];
  openedAt: number;
  probing: boolean;
}

export class CircuitBreakerRegistry {
  readonly #policy: CircuitBreakerPolicy;
  readonly #now: () => number;
  readonly #breakers = new Map<string, Breaker>();

  constructor(
    policy: CircuitBreakerPolicy = DEFAULT_CIRCUIT_POLICY,
    now: () => number = () => Date.now(),
  ) {
    this.#policy = policy;
    this.#now = now;
  }

  snapshot(id: string): CircuitState {
    return this.#ensure(id).state;
  }

  beforeCall(id: string): void {
    const b = this.#ensure(id);
    const now = this.#now();
    if (b.state === 'OPEN') {
      if (now - b.openedAt >= this.#policy.openMs) {
        b.state = 'HALF_OPEN';
        b.probing = true;
        return;
      }
      throw new CircuitOpenError();
    }
    if (b.state === 'HALF_OPEN') {
      if (b.probing) throw new CircuitOpenError();
      b.probing = true;
    }
  }

  recordSuccess(id: string): void {
    const b = this.#ensure(id);
    b.failures = [];
    b.state = 'CLOSED';
    b.probing = false;
  }

  recordFailure(id: string): void {
    const b = this.#ensure(id);
    const now = this.#now();
    b.failures.push(now);
    b.failures = b.failures.filter((t) => now - t <= this.#policy.windowMs);
    if (b.state === 'HALF_OPEN' || b.failures.length >= this.#policy.failureThreshold) {
      b.state = 'OPEN';
      b.openedAt = now;
    }
  }

  #ensure(id: string): Breaker {
    let b = this.#breakers.get(id);
    if (!b) {
      b = { state: 'CLOSED', failures: [], openedAt: 0, probing: false };
      this.#breakers.set(id, b);
    }
    return b;
  }
}
