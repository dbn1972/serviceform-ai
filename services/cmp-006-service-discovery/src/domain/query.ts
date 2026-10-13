import { isUuid } from './uuid.js';

export const CONTRACT_ID = 'SF-CON-DISCOVERY-QUERY';
export const CONTRACT_STATUS = 'FROZEN';

export const MAX_LIMIT = 100;
export const MAX_OFFSET = 10_000;
export const MAX_JURISDICTION_CODES = 16;
export const MAX_SERVICE_CODES = 32;
export const MAX_KEYWORDS = 8;
export const MAX_KEYWORD_LENGTH = 128;
export const MAX_CODE_LENGTH = 64;

export interface DiscoveryFilters {
  jurisdiction_codes: string[];
  service_codes?: string[];
  keywords?: string[];
}

export interface Pagination {
  limit: number;
  offset: number;
}

/** Mirror of the FROZEN SF-CON-DISCOVERY-QUERY envelope (contracts/m08/schemas). */
export interface DiscoveryQueryContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: typeof CONTRACT_STATUS;
  freeze_status: typeof CONTRACT_STATUS;
  tenant_id: string;
  query_id: string;
  filters: DiscoveryFilters;
  catalogue_version_id: string;
  pagination: Pagination;
  result_is_non_statutory: true;
  correlation_id: string;
}

/** Opaque master-data code: catalogue/jurisdiction codes are never interpreted, only matched. */
export function isCode(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_CODE_LENGTH) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (alnum) continue;
    if (i === 0) return false;
    if (c !== 95 && c !== 46 && c !== 58 && c !== 45) return false;
  }
  return true;
}

/** Free-text search term: printable, no control characters, already trimmed. */
export function isKeyword(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > MAX_KEYWORD_LENGTH) return false;
  if (value.trim() !== value) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }
  return true;
}

export function isLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) return false;
  const parts = value.split('-');
  const lang = parts[0] ?? '';
  if (lang.length < 2 || lang.length > 3 || !/^[a-z]+$/.test(lang)) return false;
  return parts.slice(1).every((p) => p.length >= 2 && p.length <= 8 && /^[A-Za-z0-9]+$/.test(p));
}

export function buildDiscoveryQuery(p: {
  tenantId: string;
  queryId: string;
  correlationId: string;
  filters: DiscoveryFilters;
  catalogueVersionId: string;
  pagination: Pagination;
}): DiscoveryQueryContract {
  const filters: DiscoveryFilters = { jurisdiction_codes: [...p.filters.jurisdiction_codes] };
  if (p.filters.service_codes && p.filters.service_codes.length > 0) {
    filters.service_codes = [...p.filters.service_codes];
  }
  if (p.filters.keywords && p.filters.keywords.length > 0) {
    filters.keywords = [...p.filters.keywords];
  }
  return {
    contract_id: CONTRACT_ID,
    contract_status: CONTRACT_STATUS,
    freeze_status: CONTRACT_STATUS,
    tenant_id: p.tenantId,
    query_id: p.queryId,
    filters,
    catalogue_version_id: p.catalogueVersionId,
    pagination: { limit: p.pagination.limit, offset: p.pagination.offset },
    result_is_non_statutory: true,
    correlation_id: p.correlationId,
  };
}

/** Structural self-check before anything leaves the component (frozen-schema rules). */
export function isDiscoveryQuery(q: DiscoveryQueryContract): boolean {
  const f = q.filters;
  return (
    q.contract_id === CONTRACT_ID &&
    q.contract_status === CONTRACT_STATUS &&
    q.freeze_status === CONTRACT_STATUS &&
    q.result_is_non_statutory === true &&
    isUuid(q.tenant_id) &&
    isUuid(q.query_id) &&
    isUuid(q.catalogue_version_id) &&
    isUuid(q.correlation_id) &&
    Array.isArray(f.jurisdiction_codes) &&
    f.jurisdiction_codes.length >= 1 &&
    f.jurisdiction_codes.every(isCode) &&
    (f.service_codes === undefined || f.service_codes.every(isCode)) &&
    (f.keywords === undefined || f.keywords.every(isKeyword)) &&
    Number.isInteger(q.pagination.limit) &&
    q.pagination.limit >= 1 &&
    q.pagination.limit <= MAX_LIMIT &&
    Number.isInteger(q.pagination.offset) &&
    q.pagination.offset >= 0
  );
}
