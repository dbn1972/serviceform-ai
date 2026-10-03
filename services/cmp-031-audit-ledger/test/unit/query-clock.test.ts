import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseAuditQuery,
  decodeCursor,
  encodeCursor,
  hasUnsafeActionToken,
  isResourceTypeCode,
} from '../../src/domain/query-filters.js';
import { assertClock } from '../../src/domain/clock-guard.js';
import { AuditError } from '../../src/domain/errors.js';
import { loadConfig } from '../../src/config.js';

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

  it('requires timestamps and rejects malformed dates, actions, types, and cursors', () => {
    expect(() => parseAuditQuery({}, 31, 200)).toThrow(AuditError);
    expect(() =>
      parseAuditQuery({ from: 'not-a-date', to: '2026-10-03T00:00:00Z' }, 31, 200),
    ).toThrow(AuditError);
    expect(
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', action: 'AUDIT_READ' },
        31,
        200,
      ).action,
    ).toBe('AUDIT_READ');
    expect(() =>
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', resource_type: 'notPascal' },
        31,
        200,
      ),
    ).toThrow(AuditError);
    const badCursor = Buffer.from(JSON.stringify({ t: 1, s: 'nope' }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(badCursor)).toThrow(AuditError);
    const q = parseAuditQuery(
      {
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-03T00:00:00Z',
        limit: 10,
        actor_id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42',
        action: 'WRITE',
        action_class: 'WRITE',
        resource_type: 'ExampleAggregate',
        resource_id: 'res-1',
        result: 'SUCCESS',
        correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
        cursor: encodeCursor('2026-10-01T00:00:00.000Z', 1),
      },
      31,
      200,
    );
    expect(q).toMatchObject({
      limit: 10,
      actor_id: '2c9a4e1b-7d3f-4a6b-8e2c-5f1a9b3d7e42',
      action: 'WRITE',
      resource_type: 'ExampleAggregate',
      cursor: { chain_seq: 1 },
    });
  });

  it('rejects quote/backslash action tokens and out-of-shape resource types', () => {
    expect(hasUnsafeActionToken("O'REILLY")).toBe(true);
    expect(hasUnsafeActionToken('A\\B')).toBe(true);
    expect(hasUnsafeActionToken('WRITE')).toBe(false);
    expect(hasUnsafeActionToken('AUDIT_READ')).toBe(false);
    expect(hasUnsafeActionToken('EXAMPLE%WRITE')).toBe(false);
    expect(isResourceTypeCode('ExampleAggregate')).toBe(true);
    expect(isResourceTypeCode('E')).toBe(false);
    expect(isResourceTypeCode('E'.repeat(65))).toBe(false);
    expect(isResourceTypeCode('example')).toBe(false);
    expect(isResourceTypeCode('Example-Type')).toBe(false);
    expect(() =>
      parseAuditQuery(
        { from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z', action: "X'" },
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

  it('rejects a non-timestamp occurred_at', () => {
    expect(() => assertClock('yesterday', new Date('2026-10-03T00:00:00Z'), 300)).toThrow(
      AuditError,
    );
  });
});

describe('loadConfig', () => {
  const keys = [
    'SF_AUDIT_CLOCK_SKEW_SECONDS',
    'SF_AUDIT_RATE_LIMIT_MAX',
    'SF_AUDIT_RATE_LIMIT_WINDOW_MS',
    'SF_CELL_ID',
  ] as const;
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) previous[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('falls back on non-positive rate limits and non-finite skew, and rejects a bad cell id', () => {
    process.env['SF_AUDIT_CLOCK_SKEW_SECONDS'] = 'not-a-number';
    process.env['SF_AUDIT_RATE_LIMIT_MAX'] = '0';
    process.env['SF_AUDIT_RATE_LIMIT_WINDOW_MS'] = '-5';
    process.env['SF_CELL_ID'] = 'cell-01';
    const cfg = loadConfig();
    expect(cfg.clockSkewSeconds).toBe(300);
    expect(cfg.rateLimitMax).toBe(60);
    expect(cfg.rateLimitWindowMs).toBe(60_000);
    process.env['SF_CELL_ID'] = 'not-a-cell';
    expect(() => loadConfig()).toThrow(/Invalid SF_CELL_ID/);
    process.env['SF_CELL_ID'] = 'cell-';
    expect(() => loadConfig()).toThrow(/Invalid SF_CELL_ID/);
    process.env['SF_CELL_ID'] = 'cell-BAD';
    expect(() => loadConfig()).toThrow(/Invalid SF_CELL_ID/);
    process.env['SF_CELL_ID'] = `cell-${'a'.repeat(41)}`;
    expect(() => loadConfig()).toThrow(/Invalid SF_CELL_ID/);
  });
});
