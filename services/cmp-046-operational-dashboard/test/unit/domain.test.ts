import { describe, expect, it } from 'vitest';
import {
  isStale,
  normalizeSample,
  SampleRejected,
  viewResourceId,
  worstStatus,
} from '../../src/domain/model.js';
import { isUuid } from '../../src/domain/uuid.js';
import { TENANT_A, TENANT_B } from '../doubles/fixtures.js';

const ok = (metrics: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  status: 'OK',
  metrics,
  ...extra,
});

describe('normalizeSample (aggregates only)', () => {
  it('accepts aggregate metrics with code-like dimensions', () => {
    const out = normalizeSample(
      ok([{ metric_code: 'QUEUE_DEPTH', value: 7, dimensions: { queue_code: 'INTAKE', sev: 2 } }], {
        source_observed_at: '2026-10-10T09:00:00+05:30',
      }),
    );
    expect(out.metrics[0]?.value).toBe(7);
    expect(out.source_observed_at).toBe('2026-10-10T03:30:00.000Z');
  });

  it.each([
    ['non-object', 'x'],
    ['unknown top-level field', { status: 'OK', metrics: [], rows: [] }],
    ['bad status', { status: 'GREEN', metrics: [] }],
    ['metrics not array', { status: 'OK', metrics: {} }],
    [
      'too many metrics',
      ok(Array.from({ length: 201 }, (_, i) => ({ metric_code: `M_${i}X`, value: 1 }))),
    ],
    ['lower-case metric code', ok([{ metric_code: 'depth', value: 1 }])],
    ['NaN value', ok([{ metric_code: 'DEPTH', value: Number.NaN }])],
    ['string value', ok([{ metric_code: 'DEPTH', value: '3' }])],
    ['unknown metric field', ok([{ metric_code: 'DEPTH', value: 1, note: 'free text' }])],
    [
      'uuid dimension (individual record)',
      ok([
        {
          metric_code: 'DEPTH',
          value: 1,
          dimensions: { queue_code: '22222222-2222-4222-8222-222222222222' },
        },
      ]),
    ],
    [
      'free-text dimension (spaces)',
      ok([{ metric_code: 'DEPTH', value: 1, dimensions: { queue_code: 'Jane Doe' } }]),
    ],
    [
      'email dimension',
      ok([{ metric_code: 'DEPTH', value: 1, dimensions: { queue_code: 'a@b.in' } }]),
    ],
    [
      'personal dimension key',
      ok([{ metric_code: 'DEPTH', value: 1, dimensions: { applicant_id: 'X1' } }]),
    ],
    [
      'application dimension key',
      ok([{ metric_code: 'DEPTH', value: 1, dimensions: { application_ref: 'X1' } }]),
    ],
    [
      'nested dimension',
      ok([{ metric_code: 'DEPTH', value: 1, dimensions: { queue_code: { a: 1 } } }]),
    ],
    [
      'too many dimensions',
      ok([
        {
          metric_code: 'DEPTH',
          value: 1,
          dimensions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`dim_${i}x`, 1])),
        },
      ]),
    ],
    [
      'duplicate metric identity',
      ok([
        { metric_code: 'DEPTH', value: 1 },
        { metric_code: 'DEPTH', value: 2 },
      ]),
    ],
    ['bad observed-at', ok([], { source_observed_at: 'yesterday' })],
  ])('rejects %s', (_name, raw) => {
    expect(() => normalizeSample(raw)).toThrow(SampleRejected);
  });
});

describe('freshness, status roll-up and resource ids', () => {
  it('flags never-refreshed and aged snapshots as stale', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    expect(isStale(null, now, 300)).toBe(true);
    expect(isStale('2026-10-10T09:54:00Z', now, 300)).toBe(true);
    expect(isStale('2026-10-10T09:57:00Z', now, 300)).toBe(false);
  });

  it('rolls up to the worst status', () => {
    expect(worstStatus(['OK', 'OK'])).toBe('OK');
    expect(worstStatus(['OK', 'DEGRADED'])).toBe('DEGRADED');
    expect(worstStatus(['DEGRADED', 'UNAVAILABLE', 'OK'])).toBe('UNAVAILABLE');
  });

  it('derives stable, tenant-distinct uuid resource ids', () => {
    const a = viewResourceId(TENANT_A, 'SLA_SUMMARY');
    expect(isUuid(a)).toBe(true);
    expect(a).toBe(viewResourceId(TENANT_A, 'SLA_SUMMARY'));
    expect(a).not.toBe(viewResourceId(TENANT_B, 'SLA_SUMMARY'));
    expect(a).not.toBe(viewResourceId(TENANT_A, 'EVENT_HEALTH'));
  });
});
