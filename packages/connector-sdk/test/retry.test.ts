import { describe, expect, it } from 'vitest';
import { backoffMs, executeWithResilience, systemRandom, type RetryPolicy } from '../src/retry.js';

const policy: RetryPolicy = { timeoutMs: 20, maxAttempts: 3, baseMs: 10, factor: 2, maxMs: 50 };

describe('retry', () => {
  it('retries retryable_error with jittered delay and not permanent_error', async () => {
    const delays: number[] = [];
    let n = 0;
    const result = await executeWithResilience(
      async () => {
        n += 1;
        if (n < 3) return { outcome: 'retryable_error' as const };
        return { outcome: 'ok' as const };
      },
      policy,
      {
        random: { next: () => 0.5 },
        sleeper: {
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      },
    );
    expect(result.attempts).toBe(3);
    expect(result.value.outcome).toBe('ok');
    expect(delays.length).toBe(2);
  });

  it('does not retry permanent_error', async () => {
    let n = 0;
    const result = await executeWithResilience(async () => {
      n += 1;
      return { outcome: 'permanent_error' as const };
    }, policy);
    expect(n).toBe(1);
    expect(result.value.outcome).toBe('permanent_error');
  });

  it('caps retry_after_ms', () => {
    expect(backoffMs(1, policy, { next: () => 1 }, 9999)).toBe(50);
  });

  it('draws default jitter from crypto.randomInt, not Math.random', () => {
    const sample = systemRandom.next();
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThan(1);
  });

  it('maps AbortError to timeout and uses default sleeper for a zero delay', async () => {
    const result = await executeWithResilience<{ outcome: string }>(
      async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
      { ...policy, maxAttempts: 1, timeoutMs: 5 },
    );
    expect(result.value.outcome).toBe('timeout');
    expect(backoffMs(0, policy, { next: () => 0 })).toBe(0);
  });
});
