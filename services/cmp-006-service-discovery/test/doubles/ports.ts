import type {
  CatalogueEntry,
  CataloguePort,
  CatalogueVersionPin,
} from '../../src/ports/catalogue-port.js';
import type {
  JurisdictionPort,
  JurisdictionResolution,
} from '../../src/ports/jurisdiction-port.js';
import type { LocalizationPort } from '../../src/ports/localization-port.js';
import type { SearchCandidate, SearchPort } from '../../src/ports/search-port.js';
import {
  BIND_1,
  BIND_2,
  BIND_3,
  BIND_B1,
  CATALOGUE_A,
  CATALOGUE_A_DRAFT,
  CATALOGUE_B,
  JUR_CHILD,
  JUR_INACTIVE,
  JUR_OTHER,
  JUR_PARENT,
  SVC_1,
  SVC_2,
  SVC_3,
  SVC_B1,
  TENANT_A,
  TENANT_B,
} from './fixtures.js';

export interface IndexedService extends CatalogueEntry {
  text: string;
}

function entry(
  tenant: string,
  catalogue: string,
  id: string,
  code: string,
  binding: string,
  jurisdictions: string[],
  text: string,
): IndexedService {
  return {
    tenant_id: tenant,
    catalogue_version_id: catalogue,
    service_id: id,
    service_code: code,
    category_code: 'CAT_SYNTHETIC',
    service_binding_version_id: binding,
    label_key: `svc.${code}.name`,
    jurisdiction_codes: jurisdictions,
    status: 'PUBLISHED',
    text,
  };
}

/** Synthetic catalogue: SVC_1 at parent level, SVC_2 only in JUR-Q, SVC_3 in the child district. */
export function syntheticServices(): IndexedService[] {
  return [
    entry(TENANT_A, CATALOGUE_A, SVC_1, 'SVC_SYNTHETIC_01', BIND_1, [JUR_PARENT], 'alpha certificate'),
    entry(TENANT_A, CATALOGUE_A, SVC_2, 'SVC_SYNTHETIC_02', BIND_2, [JUR_OTHER], 'beta licence'),
    entry(TENANT_A, CATALOGUE_A, SVC_3, 'SVC_SYNTHETIC_03', BIND_3, [JUR_CHILD], 'gamma certificate'),
    entry(TENANT_B, CATALOGUE_B, SVC_B1, 'SVC_SYNTHETIC_B1', BIND_B1, [JUR_PARENT], 'alpha certificate'),
  ];
}

export class FakeCatalogue implements CataloguePort {
  versions: CatalogueVersionPin[] = [
    { tenant_id: TENANT_A, catalogue_version_id: CATALOGUE_A, status: 'PUBLISHED' },
    { tenant_id: TENANT_A, catalogue_version_id: CATALOGUE_A_DRAFT, status: 'DRAFT' },
    { tenant_id: TENANT_B, catalogue_version_id: CATALOGUE_B, status: 'PUBLISHED' },
  ];
  entries: CatalogueEntry[] = syntheticServices().map(({ text: _t, ...e }) => e);
  fail = false;
  leakVersion = false;
  leakEntries = false;
  calls = 0;

  getVersion(input: {
    tenantId: string;
    catalogueVersionId: string;
  }): Promise<CatalogueVersionPin | null> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new Error('catalogue down'));
    const v = this.versions.find(
      (x) =>
        x.catalogue_version_id === input.catalogueVersionId &&
        (this.leakVersion || x.tenant_id === input.tenantId),
    );
    return Promise.resolve(v ? { ...v } : null);
  }

  getEntries(input: {
    tenantId: string;
    catalogueVersionId: string;
    serviceIds: string[];
  }): Promise<CatalogueEntry[]> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new Error('catalogue down'));
    return Promise.resolve(
      this.entries
        .filter(
          (e) =>
            input.serviceIds.includes(e.service_id) &&
            (this.leakEntries ||
              (e.tenant_id === input.tenantId &&
                e.catalogue_version_id === input.catalogueVersionId)),
        )
        .map((e) => structuredClone(e)),
    );
  }
}

export class FakeJurisdictions implements JurisdictionPort {
  table: JurisdictionResolution[] = [
    { code: JUR_PARENT, active: true, applicable_codes: [JUR_PARENT] },
    { code: JUR_CHILD, active: true, applicable_codes: [JUR_CHILD, JUR_PARENT] },
    { code: JUR_OTHER, active: true, applicable_codes: [JUR_OTHER] },
    { code: JUR_INACTIVE, active: false, applicable_codes: [JUR_INACTIVE] },
  ];
  fail = false;
  calls: { tenantId: string; codes: string[] }[] = [];

  resolve(input: { tenantId: string; codes: string[] }): Promise<JurisdictionResolution[]> {
    this.calls.push(structuredClone(input));
    if (this.fail) return Promise.reject(new Error('jurisdiction down'));
    return Promise.resolve(
      this.table.filter((r) => input.codes.includes(r.code)).map((r) => structuredClone(r)),
    );
  }
}

/** Mimics a CMP-035 projection: tenant partitioned, facet filtered, offset/limit paged. */
export class FakeSearch implements SearchPort {
  index: IndexedService[] = syntheticServices();
  fail = false;
  extra: SearchCandidate[] = [];
  calls: Parameters<SearchPort['searchServices']>[0][] = [];
  onSearch: (() => void) | undefined;

  searchServices(input: Parameters<SearchPort['searchServices']>[0]): Promise<SearchCandidate[]> {
    this.calls.push(structuredClone(input));
    this.onSearch?.();
    if (this.fail) return Promise.reject(new Error('search down'));
    const hits = this.index.filter(
      (d) =>
        d.tenant_id === input.tenantId &&
        d.catalogue_version_id === input.catalogueVersionId &&
        d.jurisdiction_codes.some((j) => input.jurisdictionCodes.includes(j)) &&
        (input.serviceCodes.length === 0 || input.serviceCodes.includes(d.service_code)) &&
        input.keywords.every((k) => d.text.includes(k.toLowerCase())),
    );
    const all: SearchCandidate[] = [
      ...hits.map((d) => ({ tenant_id: d.tenant_id, service_id: d.service_id })),
      ...this.extra,
    ];
    return Promise.resolve(all.slice(input.offset, input.offset + input.limit));
  }
}

export class FakeLocalization implements LocalizationPort {
  fail = false;
  calls: { tenantId: string; locale: string; keys: string[] }[] = [];

  resolveLabels(input: {
    tenantId: string;
    locale: string;
    keys: string[];
  }): Promise<Record<string, string>> {
    this.calls.push(structuredClone(input));
    if (this.fail) return Promise.reject(new Error('l10n down'));
    return Promise.resolve(Object.fromEntries(input.keys.map((k) => [k, `[${input.locale}] ${k}`])));
  }
}
