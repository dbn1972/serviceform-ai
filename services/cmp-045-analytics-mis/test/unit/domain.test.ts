import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '../../src/domain/envelope.js';
import { periodFor } from '../../src/domain/period.js';
import {
  isCategoryCode,
  isIdentifyingFieldName,
  safeDimensionValue,
  UNCLASSIFIED,
} from '../../src/domain/privacy.js';
import {
  contributionOf,
  matchesDefinition,
  ProjectionError,
  type ProjectionSpec,
} from '../../src/domain/projection.js';
import { isUuid, metricPointId } from '../../src/domain/uuid.js';
import { Cmp045Error } from '../../src/errors.js';
import { eventFor, TENANT_A } from '../doubles/fixtures.js';

const spec: ProjectionSpec = {
  source_event_type: 'ApplicationSubmitted',
  source_aggregate_type: 'Application',
  source_schema_version: 1,
  aggregation: 'COUNT',
  value_field: null,
  period_granularity: 'DAY',
  dimensions: [
    { key: 'service_code', source_field: 'service_code' },
    { key: 'channel', source_field: 'channel', allowed_values: ['WEB', 'MOBILE'] },
  ],
};

describe('period buckets (UTC, exclusive end)', () => {
  it('buckets by hour, day, ISO week and month', () => {
    expect(periodFor('2026-10-05T09:30:12.000Z', 'HOUR')).toEqual({
      start: '2026-10-05T09:00:00.000Z',
      end: '2026-10-05T10:00:00.000Z',
    });
    expect(periodFor('2026-10-05T23:59:59.999Z', 'DAY')).toEqual({
      start: '2026-10-05T00:00:00.000Z',
      end: '2026-10-06T00:00:00.000Z',
    });
    // 2026-10-05 is a Monday; Sunday 2026-10-11 belongs to the same ISO week.
    expect(periodFor('2026-10-11T23:00:00.000Z', 'WEEK').start).toBe('2026-10-05T00:00:00.000Z');
    expect(periodFor('2026-10-12T00:00:00.000Z', 'WEEK').start).toBe('2026-10-12T00:00:00.000Z');
    expect(periodFor('2026-12-31T23:59:59.000Z', 'MONTH')).toEqual({
      start: '2026-12-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
    });
  });

  it('refuses an unparseable timestamp', () => {
    expect(() => periodFor('not-a-date', 'DAY')).toThrow(RangeError);
  });
});

describe('privacy: dimensions are category codes, never person-level values', () => {
  it('accepts category codes and refuses identifier-shaped values', () => {
    for (const ok of ['WEB', 'IN-OD', 'FY2026', 'A', 'SERVICE_01.A'])
      expect(isCategoryCode(ok), ok).toBe(true);
    for (const bad of [
      'a.b@example.org',
      'Ravi Kumar',
      '9876543210',
      'IN-110001',
      '123e4567-e89b-12d3-a456-426614174000',
      '123E4567-E89B-12D3-A456-426614174000',
      'lowercase',
      '',
      'A'.repeat(65),
      '_LEADING',
    ]) {
      expect(isCategoryCode(bad), bad).toBe(false);
    }
  });

  it('replaces unsafe or out-of-vocabulary values with UNCLASSIFIED and never carries them', () => {
    expect(safeDimensionValue('WEB', ['WEB', 'MOBILE'])).toEqual({
      value: 'WEB',
      unclassified: false,
    });
    expect(safeDimensionValue('KIOSK', ['WEB', 'MOBILE'])).toEqual({
      value: UNCLASSIFIED,
      unclassified: true,
    });
    expect(safeDimensionValue('ravi@example.org', undefined)).toEqual({
      value: UNCLASSIFIED,
      unclassified: true,
    });
    expect(safeDimensionValue(42, undefined).unclassified).toBe(true);
    expect(safeDimensionValue({ nested: 'x' }, undefined).unclassified).toBe(true);
    expect(safeDimensionValue(undefined, undefined).unclassified).toBe(true);
    expect(safeDimensionValue(true, undefined)).toEqual({ value: true, unclassified: false });
  });

  it('flags personal and per-record identifier field names by token', () => {
    for (const name of [
      'applicant_name',
      'email',
      'mobile_number',
      'aadhaar_no',
      'application_id',
      'citizen_ref',
      'date_of_birth',
      'bank_account',
      'client_ip',
    ])
      expect(isIdentifyingFieldName(name), name).toBe(true);
    for (const name of ['service_code', 'channel', 'office_type', 'fee_amount', 'decision_outcome'])
      expect(isIdentifyingFieldName(name), name).toBe(false);
  });
});

describe('contributionOf: pure aggregation of one event', () => {
  it('derives a COUNT contribution from allowlisted fields only', () => {
    const event = eventFor(TENANT_A, {
      service_code: 'RESIDENCE_CERT',
      channel: 'WEB',
      applicant_name: 'Ravi Kumar',
      mobile: '9876543210',
    });
    const c = contributionOf(spec, event);
    expect(c.delta).toBe(1);
    expect(c.dimensions).toEqual({ channel: 'WEB', service_code: 'RESIDENCE_CERT' });
    expect(c.period_start).toBe('2026-10-05T00:00:00.000Z');
    expect(JSON.stringify(c)).not.toContain('Ravi');
    expect(JSON.stringify(c)).not.toContain('9876543210');
    expect(c.unclassified_dimensions).toBe(0);
  });

  it('is deterministic: same event and spec give the same dimension hash regardless of key order', () => {
    const a = contributionOf(spec, eventFor(TENANT_A, { service_code: 'S1', channel: 'WEB' }));
    const b = contributionOf(
      { ...spec, dimensions: [...spec.dimensions].reverse() },
      eventFor(TENANT_A, { channel: 'WEB', service_code: 'S1' }),
    );
    expect(a.dimension_hash).toBe(b.dimension_hash);
    expect(a.dimension_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('counts unclassified dimensions and keeps the event in the aggregate', () => {
    const c = contributionOf(
      spec,
      eventFor(TENANT_A, { service_code: 'x@y.org', channel: 'KIOSK' }),
    );
    expect(c.dimensions).toEqual({ channel: UNCLASSIFIED, service_code: UNCLASSIFIED });
    expect(c.unclassified_dimensions).toBe(2);
    expect(c.delta).toBe(1);
  });

  it('SUM uses only the declared numeric value field and refuses anything else', () => {
    const sum: ProjectionSpec = { ...spec, aggregation: 'SUM', value_field: 'fee_amount' };
    expect(contributionOf(sum, eventFor(TENANT_A, { fee_amount: 120.5 })).delta).toBe(120.5);
    for (const bad of ['120', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 1e13])
      expect(() => contributionOf(sum, eventFor(TENANT_A, { fee_amount: bad }))).toThrow(
        ProjectionError,
      );
  });

  it('a schema version other than the definition pin fails explicitly', () => {
    expect(() => contributionOf(spec, eventFor(TENANT_A, {}, { schema_version: 2 }))).toThrowError(
      new ProjectionError('SCHEMA_VERSION_UNSUPPORTED'),
    );
  });

  it('matches on event type and optional aggregate type only', () => {
    const e = eventFor(TENANT_A, {});
    expect(matchesDefinition(spec, e)).toBe(true);
    expect(matchesDefinition({ ...spec, source_aggregate_type: null }, e)).toBe(true);
    expect(matchesDefinition({ ...spec, source_aggregate_type: 'Payment' }, e)).toBe(false);
    expect(matchesDefinition({ ...spec, source_event_type: 'Other' }, e)).toBe(false);
  });
});

describe('metric point identity and envelope parsing', () => {
  it('metric_id is deterministic, UUID-shaped and tenant/definition/period/dimension specific', () => {
    const base = ['t1', 'd1', '2026-10-05T00:00:00.000Z', 'sha256:aa'] as const;
    const id = metricPointId(...base);
    expect(isUuid(id)).toBe(true);
    expect(metricPointId(...base)).toBe(id);
    expect(metricPointId('t2', base[1], base[2], base[3])).not.toBe(id);
    expect(metricPointId(base[0], 'd2', base[2], base[3])).not.toBe(id);
    expect(metricPointId(base[0], base[1], '2026-10-06T00:00:00.000Z', base[3])).not.toBe(id);
    expect(metricPointId(base[0], base[1], base[2], 'sha256:bb')).not.toBe(id);
  });

  it('refuses a malformed envelope and a tenant-less event', () => {
    const good = eventFor(TENANT_A, {});
    expect(parseEnvelope(good)).toEqual(good);
    for (const broken of [
      null,
      [],
      { ...good, event_id: 'nope' },
      { ...good, event_type: 'lower' },
      { ...good, schema_version: 0 },
      { ...good, cell_id: 'CELL' },
      { ...good, occurred_at: 'yesterday' },
      { ...good, data: [] },
      { ...good, actor: { type: 'ROBOT', id: good.actor.id } },
    ]) {
      expect(() => parseEnvelope(broken)).toThrow(Cmp045Error);
    }
    try {
      parseEnvelope({ ...good, tenant_id: null });
      expect.unreachable();
    } catch (e) {
      expect((e as Cmp045Error).code).toBe('SF-TEN-001');
    }
  });
});
