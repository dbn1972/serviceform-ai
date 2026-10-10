import { describe, expect, it } from 'vitest';
import {
  buildSearchDocument,
  deriveDocumentId,
  isFacetValue,
  isFacets,
  isSearchDocument,
  MAX_FACET_STRING,
} from '../../src/domain/document.js';
import {
  classifyEvent,
  isFacetPath,
  isProjectionRule,
  projectFacets,
} from '../../src/domain/projection.js';
import { parseSearchQuery } from '../../src/domain/query.js';
import { UUID_RE, isIsoTimestamp } from '../../src/domain/validate.js';
import { RULE, T1, T2 } from '../doubles/fixtures.js';

const REC = '33333333-3333-4333-8333-333333333333';

describe('document identity', () => {
  it('is a deterministic RFC 9562 v8 (SHA-256) UUID per (tenant, source component, source record)', () => {
    const a = deriveDocumentId(T1, 'CMP-015', REC);
    expect(a).toMatch(UUID_RE);
    expect(a[14]).toBe('8');
    expect(deriveDocumentId(T1, 'CMP-015', REC.toUpperCase())).toBe(a);
    expect(deriveDocumentId(T2, 'CMP-015', REC)).not.toBe(a);
    expect(deriveDocumentId(T1, 'CMP-027', REC)).not.toBe(a);
  });
});

describe('timestamps', () => {
  it('accepts RFC 3339 date-times with an offset and rejects the rest in linear time', () => {
    expect(isIsoTimestamp('2026-10-10T01:59:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-10-10t01:59:00+05:30')).toBe(true);
    expect(isIsoTimestamp('2026-10-10T01:59:00')).toBe(false);
    expect(isIsoTimestamp('2026-13-45T99:99:99Z')).toBe(false);
    expect(isIsoTimestamp(1)).toBe(false);
    const hostile = `2026-10-10${'T'.repeat(50_000)}`;
    const started = performance.now();
    expect(isIsoTimestamp(hostile)).toBe(false);
    expect(isIsoTimestamp(`2026-10-10T00:00:00.${'1'.repeat(50_000)}Z`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('SF-CON-SEARCH-DOCUMENT shape', () => {
  const doc = buildSearchDocument({
    tenantId: T1,
    documentId: deriveDocumentId(T1, 'CMP-015', REC),
    sourceCmpId: 'CMP-015',
    sourceRecordId: REC,
    facets: { state: 'SUBMITTED', fee_paid: true, count: 2 },
    correlationId: REC,
  });

  it('builds a tenant-scoped document with the frozen constants', () => {
    expect(isSearchDocument(doc)).toBe(true);
    expect(doc.tenant_scope_required).toBe(true);
    expect(doc.cross_tenant_fields_forbidden).toBe(true);
    expect(isSearchDocument({ ...doc, connector_mode: 'SANDBOX' })).toBe(true);
  });

  it('rejects cross-tenant flags, extra fields, bad ids and bad facets', () => {
    expect(isSearchDocument({ ...doc, cross_tenant_fields_forbidden: false })).toBe(false);
    expect(isSearchDocument({ ...doc, tenant_scope_required: false })).toBe(false);
    expect(isSearchDocument({ ...doc, other_tenant_id: T2 })).toBe(false);
    expect(isSearchDocument({ ...doc, tenant_id: 'x' })).toBe(false);
    expect(isSearchDocument({ ...doc, source_cmp_id: 'CMP-15' })).toBe(false);
    expect(isSearchDocument({ ...doc, connector_mode: 'MOCK' })).toBe(false);
    expect(isSearchDocument({ ...doc, correlation_id: 'nope' })).toBe(false);
    expect(isSearchDocument({ ...doc, facets: { Bad: 'x' } })).toBe(false);
    expect(isSearchDocument({ ...doc, facets: { nested: { a: 1 } } })).toBe(false);
    expect(isSearchDocument([])).toBe(false);
  });

  it('facet values are bounded scalars', () => {
    expect(isFacetValue('A')).toBe(true);
    expect(isFacetValue('')).toBe(false);
    expect(isFacetValue('x'.repeat(MAX_FACET_STRING + 1))).toBe(false);
    expect(isFacetValue('line\nbreak')).toBe(false);
    expect(isFacetValue(Number.NaN)).toBe(false);
    expect(isFacetValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFacetValue(false)).toBe(true);
    expect(isFacetValue(null)).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f_${i}`, i]));
    expect(isFacets(many)).toBe(false);
  });
});

describe('projection rules (metadata)', () => {
  it('accepts a published rule and rejects malformed ones', () => {
    expect(isProjectionRule(RULE)).toBe(true);
    expect(isProjectionRule({ ...RULE, status: 'DRAFT' })).toBe(false);
    expect(isProjectionRule({ ...RULE, rule_version: 0 })).toBe(false);
    expect(isProjectionRule({ ...RULE, rule_id: 'x' })).toBe(false);
    expect(isProjectionRule({ ...RULE, source_cmp_id: 'X' })).toBe(false);
    expect(isProjectionRule({ ...RULE, topic: '!' })).toBe(false);
    expect(isProjectionRule({ ...RULE, aggregate_type: 'lower' })).toBe(false);
    expect(isProjectionRule({ ...RULE, upsert_event_types: [] })).toBe(false);
    expect(isProjectionRule({ ...RULE, remove_event_types: ['CaseSubmitted'] })).toBe(false);
    expect(isProjectionRule({ ...RULE, remove_event_types: 'x' })).toBe(false);
    expect(isProjectionRule({ ...RULE, extra: true })).toBe(false);
    expect(isProjectionRule({ ...RULE, facets: 'x' })).toBe(false);
    expect(isProjectionRule({ ...RULE, facets: [...RULE.facets, { ...RULE.facets[0] }] })).toBe(
      false,
    );
    expect(
      isProjectionRule({
        ...RULE,
        facets: [{ name: 'p', path: 'a.__proto__', required: false }],
      }),
    ).toBe(false);
    expect(
      isProjectionRule({ ...RULE, facets: [{ name: 'ok', path: 'a', required: 'yes' }] }),
    ).toBe(false);
    expect(isProjectionRule(null)).toBe(false);
  });

  it('paths are bounded dotted identifiers', () => {
    expect(isFacetPath('a.b_c.D9')).toBe(true);
    expect(isFacetPath('a..b')).toBe(false);
    expect(isFacetPath('constructor')).toBe(false);
    expect(isFacetPath(Array.from({ length: 9 }, () => 'a').join('.'))).toBe(false);
    expect(isFacetPath(3)).toBe(false);
  });

  it('classifies event types', () => {
    expect(classifyEvent(RULE, 'CaseSubmitted')).toBe('UPSERT');
    expect(classifyEvent(RULE, 'CaseWithdrawn')).toBe('REMOVE');
    expect(classifyEvent(RULE, 'CaseNoted')).toBeNull();
  });

  it('copies only declared scalar facets', () => {
    const facets = projectFacets(RULE, {
      service_code: 'S',
      state: 'SUBMITTED',
      routing: { office_code: 'O1' },
      applicant_name: 'never',
    });
    expect(facets).toEqual({ service_code: 'S', state: 'SUBMITTED', office_code: 'O1' });
    expect(projectFacets(RULE, { service_code: 'S', state: 'X', routing: null })).toEqual({
      service_code: 'S',
      state: 'X',
    });
  });

  it('rejects missing required and non-scalar facet values', () => {
    expect(() => projectFacets(RULE, { service_code: 'S' })).toThrow(
      expect.objectContaining({
        details: [{ code: 'REQUIRED_FACET_MISSING', pointer: '/data/state' }],
      }),
    );
    expect(() => projectFacets(RULE, { service_code: 'S', state: { raw: 'x' } })).toThrow(
      expect.objectContaining({
        details: [{ code: 'FACET_VALUE_NOT_SCALAR', pointer: '/data/state' }],
      }),
    );
    expect(() =>
      projectFacets(RULE, { service_code: 'S', state: 'X', routing: { office_code: ['a'] } }),
    ).toThrow(expect.objectContaining({ code: 'SF-SYS-003' }));
  });

  it('does not read inherited properties', () => {
    const data = Object.create({ state: 'INHERITED' }) as Record<string, unknown>;
    data['service_code'] = 'S';
    expect(() => projectFacets(RULE, data)).toThrow(
      expect.objectContaining({ code: 'SF-SYS-003' }),
    );
  });
});

describe('search query parsing', () => {
  it('applies defaults', () => {
    expect(parseSearchQuery({})).toEqual({ sourceCmpId: null, facets: {}, limit: 20, after: null });
  });

  it('accepts filters and a cursor', () => {
    const after = 'ABCDEFAB-1234-4123-8123-ABCDEFABCDEF';
    expect(
      parseSearchQuery({
        source_cmp_id: 'CMP-015',
        facets: { state: 'X', num: 1 },
        limit: 5,
        after,
      }),
    ).toEqual({
      sourceCmpId: 'CMP-015',
      facets: { state: 'X', num: 1 },
      limit: 5,
      after: after.toLowerCase(),
    });
  });

  it.each([
    [null, 'BODY_NOT_OBJECT'],
    [{ tenant_id: T2 }, 'UNKNOWN_FIELD'],
    [{ source_cmp_id: 'x' }, 'INVALID_SOURCE_CMP_ID'],
    [{ facets: [] }, 'FACETS_NOT_OBJECT'],
    [
      { facets: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f_${i}`, 1])) },
      'TOO_MANY_FACETS',
    ],
    [{ facets: { Bad: 'x' } }, 'INVALID_FACET_NAME'],
    [{ facets: { ok: {} } }, 'INVALID_FACET_VALUE'],
    [{ limit: 0 }, 'INVALID_LIMIT'],
    [{ limit: 101 }, 'INVALID_LIMIT'],
    [{ limit: 1.5 }, 'INVALID_LIMIT'],
    [{ after: 'x' }, 'INVALID_CURSOR'],
  ])('rejects %j with %s', (body, code) => {
    expect(() => parseSearchQuery(body)).toThrow(
      expect.objectContaining({ code: 'SF-SYS-003', details: [expect.objectContaining({ code })] }),
    );
  });
});
