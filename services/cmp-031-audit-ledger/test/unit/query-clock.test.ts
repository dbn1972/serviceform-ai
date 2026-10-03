import { describe, expect, it } from 'vitest';
import { parseAuditQuery } from '../../src/domain/query-filters.js';
import { assertClock } from '../../src/domain/clock-guard.js';
import { AuditError } from '../../src/domain/errors.js';

describe('query-filters', () => {
  it('rejects inverted and oversized ranges and bad limits (003-28)', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(() =>
      parseAuditQuery({ from: '2026-10-03T00:00:00Z', to: '2026-10-01T00:00:00Z' }, 31, 200),
    ).toThrow(AuditError);
    expect(() =>
      parseAuditQuery({ from: '2026-08-01T00:00:00Z', to: '2026-10-03T00:00:00Z' }, 31, 200),
    ).toThrow(AuditError);
    for (const limit of [0, 201, -1, 1e9]) {
      expect(() =>
        parseAuditQuery({ from: now.toISOString(), to: now.toISOString(), limit }, 31, 200),
      ).toThrow(AuditError);
    }
    expect(() =>
      parseAuditQuery(
        { from: now.toISOString(), to: now.toISOString(), action: "X' OR '1'='1" },
        31,
        200,
      ),
    ).toThrow(AuditError);
  });
});

describe('clock-guard', () => {
  it('rejects occurred_at beyond skew', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(() => assertClock('2026-10-04T00:00:00Z', now, 300)).toThrow(AuditError);
    expect(() => assertClock('2026-09-01T00:00:00Z', now, 300)).not.toThrow();
  });
});
