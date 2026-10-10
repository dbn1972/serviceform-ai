import { createHash } from 'node:crypto';
import { CMP_ID_RE, isPlainObject, isUuid } from './validate.js';

export const CONTRACT_ID = 'SF-CON-SEARCH-DOCUMENT';
export const FACET_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
export const MAX_FACETS = 32;
export const MAX_FACET_STRING = 256;
export const CONNECTOR_MODES = ['REAL', 'SANDBOX', 'SIMULATED'] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number];

export type FacetValue = string | number | boolean;
export type Facets = Record<string, FacetValue>;

/** SF-CON-SEARCH-DOCUMENT v1 (FROZEN). additionalProperties=false. */
export interface SearchDocument {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  document_id: string;
  source_cmp_id: string;
  source_record_id: string;
  facets: Facets;
  tenant_scope_required: true;
  cross_tenant_fields_forbidden: true;
  connector_mode?: ConnectorMode;
  correlation_id?: string;
}

const DOCUMENT_KEYS = [
  'contract_id',
  'contract_status',
  'freeze_status',
  'tenant_id',
  'document_id',
  'source_cmp_id',
  'source_record_id',
  'facets',
  'tenant_scope_required',
  'cross_tenant_fields_forbidden',
  'connector_mode',
  'correlation_id',
] as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isFacetValue(value: unknown): value is FacetValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_FACET_STRING &&
    !CONTROL_CHARS.test(value)
  );
}

export function isFacets(value: unknown): value is Facets {
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_FACETS) return false;
  return entries.every(([k, v]) => FACET_NAME_RE.test(k) && isFacetValue(v));
}

export function isSearchDocument(value: unknown): value is SearchDocument {
  if (!isPlainObject(value)) return false;
  if (!Object.keys(value).every((k) => (DOCUMENT_KEYS as readonly string[]).includes(k))) {
    return false;
  }
  const v = value;
  return (
    v['contract_id'] === CONTRACT_ID &&
    v['contract_status'] === 'FROZEN' &&
    v['freeze_status'] === 'FROZEN' &&
    isUuid(v['tenant_id']) &&
    isUuid(v['document_id']) &&
    typeof v['source_cmp_id'] === 'string' &&
    CMP_ID_RE.test(v['source_cmp_id']) &&
    isUuid(v['source_record_id']) &&
    isFacets(v['facets']) &&
    v['tenant_scope_required'] === true &&
    v['cross_tenant_fields_forbidden'] === true &&
    (v['connector_mode'] === undefined ||
      (CONNECTOR_MODES as readonly unknown[]).includes(v['connector_mode'])) &&
    (v['correlation_id'] === undefined || isUuid(v['correlation_id']))
  );
}

const DOCUMENT_NAMESPACE = 'b2f1c035-5ea7-4c35-9d35-035035035035';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/**
 * RFC 9562 name-based (v5) id. One document per (tenant, source component, source record), so
 * re-delivery and re-projection converge on the same document_id.
 */
export function deriveDocumentId(
  tenantId: string,
  sourceCmpId: string,
  sourceRecordId: string,
): string {
  const hash = createHash('sha1')
    .update(uuidBytes(DOCUMENT_NAMESPACE))
    .update(`${tenantId.toLowerCase()}|${sourceCmpId}|${sourceRecordId.toLowerCase()}`)
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildSearchDocument(params: {
  tenantId: string;
  documentId: string;
  sourceCmpId: string;
  sourceRecordId: string;
  facets: Facets;
  correlationId?: string;
}): SearchDocument {
  const doc: SearchDocument = {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: params.tenantId,
    document_id: params.documentId,
    source_cmp_id: params.sourceCmpId,
    source_record_id: params.sourceRecordId,
    facets: { ...params.facets },
    tenant_scope_required: true,
    cross_tenant_fields_forbidden: true,
  };
  if (params.correlationId !== undefined) doc.correlation_id = params.correlationId;
  return doc;
}
