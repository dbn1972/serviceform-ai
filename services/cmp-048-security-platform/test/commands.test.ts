import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/idempotency.js';

describe('idempotency fingerprint', () => {
  it('is stable for the same body and differs when a field changes', () => {
    const a = fingerprint({ x: 1 });
    const b = fingerprint({ x: 1 });
    const c = fingerprint({ x: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('sha256:')).toBe(true);
  });
});
