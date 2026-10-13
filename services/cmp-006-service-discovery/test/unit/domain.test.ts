import { describe, expect, it } from 'vitest';
import {
  applicableJurisdictions,
  assertPublishedPin,
  selectAvailable,
} from '../../src/domain/availability.js';
import {
  buildDiscoveryQuery,
  isCode,
  isDiscoveryQuery,
  isKeyword,
  isLocale,
} from '../../src/domain/query.js';
import { Cmp006Error } from '../../src/errors.js';
import type { CatalogueEntry } from '../../src/ports/catalogue-port.js';
import { validateDiscoveryQuery, validateSelection } from '../../src/service/input.js';
import {
  CATALOGUE_A,
  CATALOGUE_B,
  JUR_CHILD,
  JUR_OTHER,
  JUR_PARENT,
  queryBody,
  SVC_1,
  SVC_2,
  SVC_3,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import { FakeCatalogue, FakeJurisdictions } from '../doubles/ports.js';

function errOf(fn: () => unknown): { code: string; detail?: string; pointer?: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof Cmp006Error) {
      const d = e.details?.[0];
      return {
        code: e.code,
        ...(d?.code ? { detail: d.code } : {}),
        ...(d?.pointer ? { pointer: d.pointer } : {}),
      };
    }
    throw e;
  }
  throw new Error('expected a refusal');
}

const ENTRIES: CatalogueEntry[] = new FakeCatalogue().entries.filter(
  (e) => e.tenant_id === TENANT_A,
);
const APPLICABLE = applicableJurisdictions([JUR_CHILD], new FakeJurisdictions().table);

describe('SF-CON-DISCOVERY-QUERY envelope builder', () => {
  const base = {
    tenantId: TENANT_A,
    queryId: '44444444-4444-4444-8444-444444444444',
    correlationId: '77777777-7777-4777-8777-777777777777',
    catalogueVersionId: CATALOGUE_A,
    pagination: { limit: 20, offset: 0 },
  };

  it('pins frozen constants and the non-statutory marker; omits empty optional filters', () => {
    const q = buildDiscoveryQuery({
      ...base,
      filters: { jurisdiction_codes: [JUR_CHILD], service_codes: [], keywords: [] },
    });
    expect(q.contract_id).toBe('SF-CON-DISCOVERY-QUERY');
    expect(q.contract_status).toBe('FROZEN');
    expect(q.freeze_status).toBe('FROZEN');
    expect(q.result_is_non_statutory).toBe(true);
    expect(q.filters).toEqual({ jurisdiction_codes: [JUR_CHILD] });
    expect(isDiscoveryQuery(q)).toBe(true);
  });

  it('self-check rejects envelopes the frozen schema would reject', () => {
    const ok = buildDiscoveryQuery({ ...base, filters: { jurisdiction_codes: [JUR_CHILD] } });
    expect(isDiscoveryQuery({ ...ok, filters: { jurisdiction_codes: [] } })).toBe(false);
    expect(isDiscoveryQuery({ ...ok, pagination: { limit: 0, offset: 0 } })).toBe(false);
    expect(isDiscoveryQuery({ ...ok, pagination: { limit: 101, offset: 0 } })).toBe(false);
    expect(isDiscoveryQuery({ ...ok, tenant_id: 'not-a-uuid' })).toBe(false);
    expect(isDiscoveryQuery({ ...ok, result_is_non_statutory: false as unknown as true })).toBe(
      false,
    );
  });

  it('code / keyword / locale checks', () => {
    for (const c of ['JUR-P', 'SVC_SYNTHETIC_01', 'a.b:c-d', 'X']) expect(isCode(c), c).toBe(true);
    for (const c of ['', '-x', 'a b', 'x'.repeat(65), 'a/b', 7])
      expect(isCode(c), String(c)).toBe(false);
    expect(isKeyword('certificate')).toBe(true);
    for (const k of ['', ' lead', 'trail ', 'a\nb', 'x'.repeat(129)])
      expect(isKeyword(k)).toBe(false);
    for (const l of ['en', 'en-IN', 'hi', 'or-Latn-IN']) expect(isLocale(l), l).toBe(true);
    for (const l of ['E', 'EN', 'en_IN', 'en-', 'toolonglang']) expect(isLocale(l), l).toBe(false);
  });
});

describe('catalogue pin (fail closed)', () => {
  it('missing pin is 404, another tenant pin is a cross-tenant refusal, unpublished is 409', () => {
    expect(errOf(() => assertPublishedPin(TENANT_A, CATALOGUE_A, null))).toMatchObject({
      code: 'SF-SYS-002',
      detail: 'CATALOGUE_VERSION_NOT_FOUND',
    });
    expect(
      errOf(() =>
        assertPublishedPin(TENANT_A, CATALOGUE_B, {
          tenant_id: TENANT_B,
          catalogue_version_id: CATALOGUE_B,
          status: 'PUBLISHED',
        }),
      ),
    ).toMatchObject({ code: 'SF-TEN-002', detail: 'CROSS_TENANT_RESULT_BLOCKED' });
    for (const status of ['DRAFT', 'RETIRED'] as const) {
      expect(
        errOf(() =>
          assertPublishedPin(TENANT_A, CATALOGUE_A, {
            tenant_id: TENANT_A,
            catalogue_version_id: CATALOGUE_A,
            status,
          }),
        ),
      ).toMatchObject({ code: 'SF-APP-001', detail: 'CATALOGUE_VERSION_NOT_PUBLISHED' });
    }
    expect(() =>
      assertPublishedPin(TENANT_A, CATALOGUE_A, {
        tenant_id: TENANT_A,
        catalogue_version_id: CATALOGUE_A,
        status: 'PUBLISHED',
      }),
    ).not.toThrow();
  });
});

describe('jurisdiction-aware availability (master data via CMP-003 port)', () => {
  it('expands only what master data says applies', () => {
    expect([...APPLICABLE].sort()).toEqual([JUR_PARENT, JUR_CHILD].sort());
    const other = applicableJurisdictions([JUR_OTHER], new FakeJurisdictions().table);
    expect([...other]).toEqual([JUR_OTHER]);
  });

  it('unknown and inactive requested codes are refused with a pointer', () => {
    const table = new FakeJurisdictions().table;
    expect(errOf(() => applicableJurisdictions([JUR_CHILD, 'JUR-NONE'], table))).toEqual({
      code: 'SF-SYS-003',
      detail: 'JURISDICTION_CODE_UNKNOWN',
      pointer: '/filters/jurisdiction_codes/1',
    });
    expect(errOf(() => applicableJurisdictions(['JUR-OLD'], table))).toMatchObject({
      detail: 'JURISDICTION_CODE_INACTIVE',
    });
  });

  it('keeps search rank order and drops unavailable, unpublished, unpinned or unknown entries', () => {
    const entries = ENTRIES.map((e) =>
      e.service_id === SVC_2 ? { ...e, jurisdiction_codes: [JUR_OTHER] } : e,
    );
    const { items, excluded } = selectAvailable({
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      serviceCodes: [],
      candidates: [
        { tenant_id: TENANT_A, service_id: SVC_3 },
        { tenant_id: TENANT_A, service_id: SVC_2 },
        { tenant_id: TENANT_A, service_id: SVC_1 },
        { tenant_id: TENANT_A, service_id: SVC_1 },
        { tenant_id: TENANT_A, service_id: 'c9999999-9999-4999-8999-999999999999' },
      ],
      entries,
      applicable: APPLICABLE,
    });
    expect(items.map((i) => [i.rank, i.service_id, i.matched_jurisdiction_codes])).toEqual([
      [1, SVC_3, [JUR_CHILD]],
      [2, SVC_1, [JUR_PARENT]],
    ]);
    expect(excluded).toBe(2);

    const retired = selectAvailable({
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      serviceCodes: [],
      candidates: [{ tenant_id: TENANT_A, service_id: SVC_1 }],
      entries: entries.map((e) => ({ ...e, status: 'RETIRED' as const })),
      applicable: APPLICABLE,
    });
    expect(retired.items).toEqual([]);
    const wrongPin = selectAvailable({
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      serviceCodes: [],
      candidates: [{ tenant_id: TENANT_A, service_id: SVC_1 }],
      entries: entries.map((e) => ({ ...e, catalogue_version_id: CATALOGUE_B })),
      applicable: APPLICABLE,
    });
    expect(wrongPin.items).toEqual([]);
  });

  it('service_codes filter is enforced again after search', () => {
    const { items } = selectAvailable({
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      serviceCodes: ['SVC_SYNTHETIC_03'],
      candidates: [
        { tenant_id: TENANT_A, service_id: SVC_1 },
        { tenant_id: TENANT_A, service_id: SVC_3 },
      ],
      entries: ENTRIES,
      applicable: APPLICABLE,
    });
    expect(items.map((i) => i.service_id)).toEqual([SVC_3]);
  });

  it('any candidate or entry from another tenant aborts the query', () => {
    const base = {
      tenantId: TENANT_A,
      catalogueVersionId: CATALOGUE_A,
      serviceCodes: [],
      applicable: APPLICABLE,
    };
    expect(
      errOf(() =>
        selectAvailable({
          ...base,
          candidates: [{ tenant_id: TENANT_B, service_id: SVC_1 }],
          entries: ENTRIES,
        }),
      ),
    ).toEqual({ code: 'SF-TEN-002', detail: 'CROSS_TENANT_RESULT_BLOCKED' });
    expect(
      errOf(() =>
        selectAvailable({
          ...base,
          candidates: [{ tenant_id: TENANT_A, service_id: SVC_1 }],
          entries: ENTRIES.map((e) => ({ ...e, tenant_id: TENANT_B })),
        }),
      ),
    ).toMatchObject({ code: 'SF-TEN-002' });
  });
});

describe('request validation', () => {
  it('accepts the documented shape, trims and de-duplicates', () => {
    const v = validateDiscoveryQuery(
      queryBody({
        contract_id: 'SF-CON-DISCOVERY-QUERY',
        result_is_non_statutory: true,
        filters: {
          jurisdiction_codes: [JUR_CHILD, JUR_CHILD],
          service_codes: ['SVC_SYNTHETIC_01'],
          keywords: [' alpha ', 'alpha'],
        },
        catalogue_version_id: CATALOGUE_A.toUpperCase(),
        locale: 'en-IN',
      }),
    );
    expect(v).toEqual({
      filters: {
        jurisdiction_codes: [JUR_CHILD],
        service_codes: ['SVC_SYNTHETIC_01'],
        keywords: ['alpha'],
      },
      catalogue_version_id: CATALOGUE_A,
      pagination: { limit: 20, offset: 0 },
      locale: 'en-IN',
    });
  });

  it('tenant is never client supplied; server-owned and time fields are refused', () => {
    expect(errOf(() => validateDiscoveryQuery(queryBody({ tenant_id: TENANT_B })))).toMatchObject({
      code: 'SF-TEN-002',
    });
    for (const key of ['query_id', 'correlation_id']) {
      expect(
        errOf(() => validateDiscoveryQuery(queryBody({ [key]: SVC_1 }))),
        key,
      ).toMatchObject({
        code: 'SF-SYS-003',
        detail: 'SERVER_OWNED_FIELD',
      });
    }
    expect(errOf(() => validateDiscoveryQuery(queryBody({ now: 'x' })))).toMatchObject({
      detail: 'CLIENT_TIME_NOT_AUTHORITATIVE',
    });
  });

  it('statutory marker cannot be flipped and constants cannot change', () => {
    expect(
      errOf(() => validateDiscoveryQuery(queryBody({ result_is_non_statutory: false }))),
    ).toMatchObject({ detail: 'CONSTANT_MARKER_MISMATCH', pointer: '/result_is_non_statutory' });
    expect(
      errOf(() => validateDiscoveryQuery(queryBody({ contract_status: 'DRAFT' }))),
    ).toMatchObject({ detail: 'CONSTANT_MARKER_MISMATCH' });
  });

  it('refuses malformed filters, pins and pagination', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ filters: undefined }, 'FILTERS_REQUIRED'],
      [{ filters: { jurisdiction_codes: [] } }, 'AT_LEAST_ONE_REQUIRED'],
      [{ filters: { jurisdiction_codes: ['bad code'] } }, 'CODE_INVALID'],
      [{ filters: { jurisdiction_codes: [JUR_CHILD], extra: 1 } }, 'UNKNOWN_FIELD'],
      [{ filters: { jurisdiction_codes: [JUR_CHILD], keywords: ['a\u0000b'] } }, 'KEYWORD_INVALID'],
      [
        {
          filters: {
            jurisdiction_codes: [JUR_CHILD],
            keywords: Array(9)
              .fill('k')
              .map((k, i) => k + i),
          },
        },
        'TOO_MANY_ITEMS',
      ],
      [{ catalogue_version_id: 'v1' }, 'UUID_REQUIRED'],
      [{ pagination: undefined }, 'PAGINATION_REQUIRED'],
      [{ pagination: { limit: 0, offset: 0 } }, 'LIMIT_INVALID'],
      [{ pagination: { limit: 101, offset: 0 } }, 'LIMIT_INVALID'],
      [{ pagination: { limit: 1.5, offset: 0 } }, 'LIMIT_INVALID'],
      [{ pagination: { limit: 10, offset: -1 } }, 'OFFSET_INVALID'],
      [{ pagination: { limit: 10, offset: 10_001 } }, 'OFFSET_INVALID'],
      [{ pagination: { limit: 10, offset: 0, cursor: 'x' } }, 'UNKNOWN_FIELD'],
      [{ locale: 'EN' }, 'LOCALE_INVALID'],
      [{ surprise: true }, 'UNKNOWN_FIELD'],
    ];
    for (const [over, code] of cases) {
      expect(
        errOf(() => validateDiscoveryQuery(queryBody(over))),
        code,
      ).toMatchObject({
        code: 'SF-SYS-003',
        detail: code,
      });
    }
    expect(errOf(() => validateDiscoveryQuery([]))).toMatchObject({ detail: 'OBJECT_REQUIRED' });
  });

  it('selection body carries a service id only', () => {
    expect(validateSelection({ service_id: SVC_1.toUpperCase() })).toEqual({ service_id: SVC_1 });
    expect(errOf(() => validateSelection({ service_id: 'x' }))).toMatchObject({
      detail: 'UUID_REQUIRED',
    });
    expect(errOf(() => validateSelection({ service_id: SVC_1, actor_id: SVC_2 }))).toMatchObject({
      detail: 'SERVER_OWNED_FIELD',
    });
    expect(
      errOf(() => validateSelection({ service_id: SVC_1, tenant_id: TENANT_A })),
    ).toMatchObject({ code: 'SF-TEN-002' });
  });
});
