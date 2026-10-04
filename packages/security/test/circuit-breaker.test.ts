import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/pep/circuit-breaker.js';

describe('CircuitBreaker (002-22)', () => {
  it('opens after N failures and admits one half-open probe', () => {
    const b = new CircuitBreaker(5, 10);
    const t0 = 1_000;
    for (let i = 0; i < 5; i += 1) {
      expect(b.tryEnter(t0)).toBe(true);
      b.onFailure(t0);
    }
    expect(b.state(t0)).toBe('open');
    expect(b.tryEnter(t0)).toBe(false);
    const t1 = t0 + 11;
    expect(b.state(t1)).toBe('half_open');
    expect(b.tryEnter(t1)).toBe(true);
    expect(b.tryEnter(t1)).toBe(false);
    b.onSuccess();
    expect(b.state(t1 + 1)).toBe('closed');
  });
});
