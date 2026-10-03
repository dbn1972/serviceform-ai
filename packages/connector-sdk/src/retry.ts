export interface RetryPolicy {
  timeoutMs: number;
  maxAttempts: number;
  baseMs: number;
  factor: number;
  maxMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  baseMs: 100,
  factor: 2,
  maxMs: 2_000,
};

export interface Clock {
  now(): number;
}

export interface Sleeper {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface RandomSource {
  next(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const systemSleeper: Sleeper = {
  async sleep(ms, signal) {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => resolve(), ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  },
};

export const systemRandom: RandomSource = { next: () => Math.random() };

export function backoffMs(
  attempt: number,
  policy: RetryPolicy,
  random: RandomSource,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, policy.maxMs);
  }
  const exp = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt));
  const jitter = random.next() * exp;
  return Math.min(policy.maxMs, jitter);
}

export type AttemptFn<T> = (attempt: number, signal: AbortSignal) => Promise<T>;

export interface ResilienceResult<T> {
  value: T;
  attempts: number;
}

export async function executeWithResilience<T extends { outcome: string; retry_after_ms?: number }>(
  fn: AttemptFn<T>,
  policy: RetryPolicy,
  deps: { clock?: Clock; sleeper?: Sleeper; random?: RandomSource; signal?: AbortSignal } = {},
): Promise<ResilienceResult<T>> {
  const sleeper = deps.sleeper ?? systemSleeper;
  const random = deps.random ?? systemRandom;
  const parent = deps.signal;
  let last: T | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const timeout = AbortSignal.timeout(policy.timeoutMs);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    try {
      last = await fn(attempt, signal);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        last = { outcome: 'timeout' } as T;
      } else {
        throw err;
      }
    }
    if (last.outcome === 'ok' || last.outcome === 'permanent_error') {
      return { value: last, attempts: attempt };
    }
    if (attempt >= policy.maxAttempts) return { value: last, attempts: attempt };
    await sleeper.sleep(backoffMs(attempt, policy, random, last.retry_after_ms), parent);
  }
  return { value: last as T, attempts: policy.maxAttempts };
}
