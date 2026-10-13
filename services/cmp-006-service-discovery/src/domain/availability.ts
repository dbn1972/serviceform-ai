import { Cmp006Error, detail } from '../errors.js';
import type { CatalogueEntry, CatalogueVersionPin } from '../ports/catalogue-port.js';
import type { JurisdictionResolution } from '../ports/jurisdiction-port.js';
import type { SearchCandidate } from '../ports/search-port.js';

export interface DiscoveryResultItem {
  rank: number;
  service_id: string;
  service_code: string;
  category_code: string | null;
  service_binding_version_id: string;
  catalogue_version_id: string;
  label_key: string | null;
  matched_jurisdiction_codes: string[];
}

function crossTenant(): Cmp006Error {
  return new Cmp006Error('SF-TEN-002', detail('CROSS_TENANT_RESULT_BLOCKED'));
}

/** The pin must exist, belong to the caller's tenant and be published; otherwise fail closed. */
export function assertPublishedPin(
  tenantId: string,
  catalogueVersionId: string,
  pin: CatalogueVersionPin | null,
): void {
  if (pin === null) {
    throw new Cmp006Error(
      'SF-SYS-002',
      detail('CATALOGUE_VERSION_NOT_FOUND', '/catalogue_version_id'),
    );
  }
  if (pin.tenant_id !== tenantId) throw crossTenant();
  if (pin.catalogue_version_id !== catalogueVersionId || pin.status !== 'PUBLISHED') {
    throw new Cmp006Error(
      'SF-APP-001',
      detail('CATALOGUE_VERSION_NOT_PUBLISHED', '/catalogue_version_id'),
    );
  }
}

/**
 * Expands the requested jurisdictions to every code whose services apply there, using only the
 * CMP-003 answer. Unknown or inactive requested codes are refused rather than silently ignored.
 */
export function applicableJurisdictions(
  requested: readonly string[],
  resolutions: readonly JurisdictionResolution[],
): Set<string> {
  const byCode = new Map(resolutions.map((r) => [r.code, r]));
  const applicable = new Set<string>();
  requested.forEach((code, i) => {
    const r = byCode.get(code);
    if (!r) {
      throw new Cmp006Error(
        'SF-SYS-003',
        detail('JURISDICTION_CODE_UNKNOWN', `/filters/jurisdiction_codes/${i}`),
      );
    }
    if (r.active !== true) {
      throw new Cmp006Error(
        'SF-SYS-003',
        detail('JURISDICTION_CODE_INACTIVE', `/filters/jurisdiction_codes/${i}`),
      );
    }
    applicable.add(code);
    for (const c of r.applicable_codes) applicable.add(c);
  });
  return applicable;
}

/**
 * Keeps search candidates, in search rank order, that the pinned catalogue publishes and that
 * are available in at least one applicable jurisdiction. Anything carrying another tenant aborts
 * the whole query. Stale or unavailable candidates are dropped and counted, never guessed at.
 */
export function selectAvailable(p: {
  tenantId: string;
  catalogueVersionId: string;
  serviceCodes: readonly string[];
  candidates: readonly SearchCandidate[];
  entries: readonly CatalogueEntry[];
  applicable: ReadonlySet<string>;
}): { items: DiscoveryResultItem[]; excluded: number } {
  if (p.candidates.some((c) => c.tenant_id !== p.tenantId)) throw crossTenant();
  if (p.entries.some((e) => e.tenant_id !== p.tenantId)) throw crossTenant();
  const entries = new Map(p.entries.map((e) => [e.service_id, e]));
  const wantedCodes = new Set(p.serviceCodes);
  const seen = new Set<string>();
  const items: DiscoveryResultItem[] = [];
  let excluded = 0;
  for (const c of p.candidates) {
    if (seen.has(c.service_id)) continue;
    seen.add(c.service_id);
    const e = entries.get(c.service_id);
    const matched = e ? [...new Set(e.jurisdiction_codes)].filter((j) => p.applicable.has(j)) : [];
    const ok =
      e !== undefined &&
      e.status === 'PUBLISHED' &&
      e.catalogue_version_id === p.catalogueVersionId &&
      (wantedCodes.size === 0 || wantedCodes.has(e.service_code)) &&
      matched.length > 0;
    if (!ok || !e) {
      excluded += 1;
      continue;
    }
    items.push({
      rank: items.length + 1,
      service_id: e.service_id,
      service_code: e.service_code,
      category_code: e.category_code,
      service_binding_version_id: e.service_binding_version_id,
      catalogue_version_id: e.catalogue_version_id,
      label_key: e.label_key,
      matched_jurisdiction_codes: matched.sort(),
    });
  }
  return { items, excluded };
}
