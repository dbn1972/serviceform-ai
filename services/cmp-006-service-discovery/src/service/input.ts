import {
  CONTRACT_ID,
  CONTRACT_STATUS,
  isCode,
  isKeyword,
  isLocale,
  MAX_JURISDICTION_CODES,
  MAX_KEYWORDS,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_SERVICE_CODES,
  type DiscoveryFilters,
  type Pagination,
} from '../domain/query.js';
import { isUuid } from '../domain/uuid.js';
import { Cmp006Error, detail } from '../errors.js';

export const CLIENT_TIME_KEYS: ReadonlySet<string> = new Set([
  'now',
  'clock_now',
  'current_time',
  'server_time',
  'timestamp',
  'occurred_at',
  'created_at',
  'selected_at',
]);

/** Server-derived identifiers: a client may never set them. */
const SERVER_OWNED_KEYS: ReadonlySet<string> = new Set([
  'query_id',
  'correlation_id',
  'selection_id',
  'actor_id',
  'actor_type',
]);

/** Constant contract markers a client may echo but never change. */
const CONSTANT_MARKERS: Readonly<Record<string, unknown>> = {
  contract_id: CONTRACT_ID,
  contract_status: CONTRACT_STATUS,
  freeze_status: CONTRACT_STATUS,
  result_is_non_statutory: true,
};

function bad(pointer: string, code = 'INVALID_VALUE'): never {
  throw new Cmp006Error('SF-SYS-003', detail(code, pointer));
}

function asRecord(value: unknown, pointer = '/'): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) bad(pointer, 'OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

export function assertNoClientTime(source: Record<string, unknown>, where: 'body' | 'query'): void {
  for (const key of Object.keys(source)) {
    if (CLIENT_TIME_KEYS.has(key)) {
      throw new Cmp006Error(
        'SF-SYS-003',
        detail('CLIENT_TIME_NOT_AUTHORITATIVE', `/${where}/${key}`),
      );
    }
  }
}

function commonChecks(rec: Record<string, unknown>, allowed: readonly string[]): void {
  assertNoClientTime(rec, 'body');
  if ('tenant_id' in rec) throw new Cmp006Error('SF-TEN-002', detail('TENANT_ID_SERVER_DERIVED'));
  for (const key of Object.keys(rec)) {
    if (SERVER_OWNED_KEYS.has(key)) bad(`/${key}`, 'SERVER_OWNED_FIELD');
    if (!allowed.includes(key)) bad(`/${key}`, 'UNKNOWN_FIELD');
  }
}

function codeList(
  value: unknown,
  pointer: string,
  max: number,
  opts: { required: boolean },
): string[] {
  if (value === undefined && !opts.required) return [];
  if (!Array.isArray(value)) bad(pointer, 'ARRAY_REQUIRED');
  if (opts.required && value.length === 0) bad(pointer, 'AT_LEAST_ONE_REQUIRED');
  if (value.length > max) bad(pointer, 'TOO_MANY_ITEMS');
  const out: string[] = [];
  value.forEach((v, i) => {
    if (!isCode(v)) bad(`${pointer}/${i}`, 'CODE_INVALID');
    if (!out.includes(v)) out.push(v);
  });
  return out;
}

function keywordList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad('/filters/keywords', 'ARRAY_REQUIRED');
  if (value.length > MAX_KEYWORDS) bad('/filters/keywords', 'TOO_MANY_ITEMS');
  const out: string[] = [];
  value.forEach((v, i) => {
    const t = typeof v === 'string' ? v.trim() : v;
    if (!isKeyword(t)) bad(`/filters/keywords/${i}`, 'KEYWORD_INVALID');
    if (!out.includes(t)) out.push(t);
  });
  return out;
}

export interface DiscoveryQueryInput {
  filters: DiscoveryFilters;
  catalogue_version_id: string;
  pagination: Pagination;
  locale: string | null;
}

export function validateDiscoveryQuery(body: unknown): DiscoveryQueryInput {
  const rec = asRecord(body);
  commonChecks(rec, [
    'filters',
    'catalogue_version_id',
    'pagination',
    'locale',
    ...Object.keys(CONSTANT_MARKERS),
  ]);
  for (const [marker, expected] of Object.entries(CONSTANT_MARKERS)) {
    if (marker in rec && rec[marker] !== expected) bad(`/${marker}`, 'CONSTANT_MARKER_MISMATCH');
  }

  if (rec['filters'] === undefined) bad('/filters', 'FILTERS_REQUIRED');
  const f = asRecord(rec['filters'], '/filters');
  for (const key of Object.keys(f)) {
    if (!['jurisdiction_codes', 'service_codes', 'keywords'].includes(key)) {
      bad(`/filters/${key}`, 'UNKNOWN_FIELD');
    }
  }
  const filters: DiscoveryFilters = {
    jurisdiction_codes: codeList(
      f['jurisdiction_codes'],
      '/filters/jurisdiction_codes',
      MAX_JURISDICTION_CODES,
      { required: true },
    ),
  };
  const serviceCodes = codeList(f['service_codes'], '/filters/service_codes', MAX_SERVICE_CODES, {
    required: false,
  });
  if (serviceCodes.length > 0) filters.service_codes = serviceCodes;
  const keywords = keywordList(f['keywords']);
  if (keywords.length > 0) filters.keywords = keywords;

  const pin = rec['catalogue_version_id'];
  if (typeof pin !== 'string' || !isUuid(pin)) bad('/catalogue_version_id', 'UUID_REQUIRED');

  if (rec['pagination'] === undefined) bad('/pagination', 'PAGINATION_REQUIRED');
  const pg = asRecord(rec['pagination'], '/pagination');
  for (const key of Object.keys(pg)) {
    if (key !== 'limit' && key !== 'offset') bad(`/pagination/${key}`, 'UNKNOWN_FIELD');
  }
  const limit = pg['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    bad('/pagination/limit', 'LIMIT_INVALID');
  }
  const offset = pg['offset'];
  if (
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > MAX_OFFSET
  ) {
    bad('/pagination/offset', 'OFFSET_INVALID');
  }

  const locale = rec['locale'];
  if (locale !== undefined && !isLocale(locale)) bad('/locale', 'LOCALE_INVALID');

  return {
    filters,
    catalogue_version_id: pin.toLowerCase(),
    pagination: { limit, offset },
    locale: typeof locale === 'string' ? locale : null,
  };
}

export function validateSelection(body: unknown): { service_id: string } {
  const rec = asRecord(body);
  commonChecks(rec, ['service_id']);
  const id = rec['service_id'];
  if (typeof id !== 'string' || !isUuid(id)) bad('/service_id', 'UUID_REQUIRED');
  return { service_id: id.toLowerCase() };
}

export function validateEmptyInput(body: unknown): void {
  commonChecks(asRecord(body), []);
}

export function validateId(value: string | undefined, pointer: string): string {
  if (value === undefined || !isUuid(value)) bad(pointer, 'UUID_REQUIRED');
  return value.toLowerCase();
}
