import { describe, expect, it } from 'vitest';
import { hasIsoDateTimePrefix, parseIsoInstant } from '../../src/domain/timestamp.js';
import { parseMetricQuery } from '../../src/service/input.js';

describe('bounded fixed-position timestamp parsing', () => {
  it('accepts ISO date-times and returns epoch milliseconds', () => {
    expect(parseIsoInstant('2026-10-05T00:00:00Z')).toBe(Date.parse('2026-10-05T00:00:00Z'));
    expect(parseIsoInstant('2026-10-05T09:30:12.123+05:30')).toBe(
      Date.parse('2026-10-05T04:00:12.123Z'),
    );
    expect(hasIsoDateTimePrefix('2026-10-05T')).toBe(true);
  });

  it('refuses wrong shapes, wrong separators, non-digits and non-dates', () => {
    for (const bad of [
      '',
      'yesterday',
      '2026-10-05',
      '2026/10/05T00:00:00Z',
      '2026-10-05 00:00:00Z',
      '2026-1a-05T00:00:00Z',
      'x026-10-05T00:00:00Z',
      '2026-13-45T99:99:99Z',
      '２０２６-10-05T00:00:00Z',
    ]) {
      expect(parseIsoInstant(bad), bad).toBeNull();
    }
  });

  it('is length-bounded: oversized input is refused before any parsing', () => {
    const long = `2026-10-05T${'0'.repeat(100_000)}`;
    expect(hasIsoDateTimePrefix(long)).toBe(false);
    expect(parseIsoInstant(long)).toBeNull();
    expect(() => parseMetricQuery({ metric_code: 'M1', period_from: long })).toThrowError(
      expect.objectContaining({ code: 'SF-SYS-003' }),
    );
  });
});
