import { Cmp035Error, detail } from '../errors.js';
import { FACET_NAME_RE, isFacetValue, type Facets } from './document.js';
import { CMP_ID_RE, isPlainObject, isUuid } from './validate.js';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_FILTER_FACETS = 8;

export interface SearchQuery {
  sourceCmpId: string | null;
  facets: Facets;
  limit: number;
  after: string | null;
}

const QUERY_KEYS = ['source_cmp_id', 'facets', 'limit', 'after'] as const;

function invalid(code: string, pointer: string): Cmp035Error {
  return new Cmp035Error('SF-SYS-003', { details: detail(code, pointer) });
}

/**
 * Query input never carries a tenant: the tenant comes only from the verified request context.
 */
export function parseSearchQuery(body: unknown): SearchQuery {
  if (!isPlainObject(body)) throw invalid('BODY_NOT_OBJECT', '');
  for (const k of Object.keys(body)) {
    if (!(QUERY_KEYS as readonly string[]).includes(k)) throw invalid('UNKNOWN_FIELD', `/${k}`);
  }
  const src = body['source_cmp_id'];
  if (src !== undefined && (typeof src !== 'string' || !CMP_ID_RE.test(src))) {
    throw invalid('INVALID_SOURCE_CMP_ID', '/source_cmp_id');
  }
  const rawFacets = body['facets'] ?? {};
  if (!isPlainObject(rawFacets)) throw invalid('FACETS_NOT_OBJECT', '/facets');
  const entries = Object.entries(rawFacets);
  if (entries.length > MAX_FILTER_FACETS) throw invalid('TOO_MANY_FACETS', '/facets');
  const facets: Facets = {};
  for (const [name, value] of entries) {
    if (!FACET_NAME_RE.test(name)) throw invalid('INVALID_FACET_NAME', `/facets/${name}`);
    if (!isFacetValue(value)) throw invalid('INVALID_FACET_VALUE', `/facets/${name}`);
    facets[name] = value;
  }
  const rawLimit = body['limit'] ?? DEFAULT_LIMIT;
  if (!Number.isInteger(rawLimit) || (rawLimit as number) < 1 || (rawLimit as number) > MAX_LIMIT) {
    throw invalid('INVALID_LIMIT', '/limit');
  }
  const after = body['after'];
  if (after !== undefined && !isUuid(after)) throw invalid('INVALID_CURSOR', '/after');
  return {
    sourceCmpId: typeof src === 'string' ? src : null,
    facets,
    limit: rawLimit as number,
    after: typeof after === 'string' ? after.toLowerCase() : null,
  };
}
