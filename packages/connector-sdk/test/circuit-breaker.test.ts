import { describe, expect, it } from 'vitest';
import { CircuitBreakerRegistry, CircuitOpenError } from '../src/index.js';

describe('circuit breaker', () => {
  it('opens after the failure threshold and fail-fasts, then probes once', () => {
    let now = 0;
    const br = new CircuitBreakerRegistry(
      { failureThreshold: 2, windowMs: 1000, openMs: 50 },
      () => now,
    );
    br.recordFailure('b');
    br.recordFailure('b');
    expect(br.snapshot('b')).toBe('OPEN');
    expect(() => br.beforeCall('b')).toThrow(CircuitOpenError);
    now = 60;
    br.beforeCall('b');
    expect(br.snapshot('b')).toBe('HALF_OPEN');
    expect(() => br.beforeCall('b')).toThrow(CircuitOpenError);
    br.recordSuccess('b');
    expect(br.snapshot('b')).toBe('CLOSED');
  });
});
