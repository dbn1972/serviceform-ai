import { describe, expect, it } from 'vitest';
import { backoffMs, classifyErrorCode } from '../src/publisher/backoff.js';

describe('backoff and classify (U5, U6)', () => {
  it('caps exponential backoff', () => {
    const v = backoffMs(20, 250, 1000);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1000);
    const low = backoffMs(1, 250, 30_000);
    expect(low).toBeGreaterThanOrEqual(250);
    expect(low).toBeLessThanOrEqual(750);
  });

  it('classifies retryable vs fatal', () => {
    expect(classifyErrorCode('BROKER_UNAVAILABLE')).toBe('retryable');
    expect(classifyErrorCode('TIMEOUT')).toBe('retryable');
    expect(classifyErrorCode('TOPIC_UNREGISTERED')).toBe('retryable');
    expect(classifyErrorCode('ENVELOPE_INVALID')).toBe('fatal');
    expect(classifyErrorCode('DATA_SCHEMA_INVALID')).toBe('fatal');
  });
});
