import { describe, expect, it } from 'vitest';
import { murmur2, partitionForKey, toPositive } from '../src/transport/partitioner.js';

describe('murmur2 partitioner (U8)', () => {
  it('is stable and in range', () => {
    const a = partitionForKey('agg-1', 6);
    const b = partitionForKey('agg-1', 6);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(6);
    expect(toPositive(-1)).toBe(0x7fffffff);
    expect(murmur2(Buffer.from('hello'))).toBe(murmur2(Buffer.from('hello')));
  });
});
