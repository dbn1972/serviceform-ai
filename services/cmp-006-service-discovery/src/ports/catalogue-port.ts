export type CatalogueStatus = 'PUBLISHED' | 'DRAFT' | 'RETIRED';

export interface CatalogueVersionPin {
  tenant_id: string;
  catalogue_version_id: string;
  status: CatalogueStatus;
}

/**
 * One service as listed in a pinned catalogue version. `service_binding_version_id` is the
 * TenantServiceBinding version an application draft must pin; `jurisdiction_codes` is the
 * master-data availability the catalogue publishes for the service.
 */
export interface CatalogueEntry {
  tenant_id: string;
  catalogue_version_id: string;
  service_id: string;
  service_code: string;
  category_code: string | null;
  service_binding_version_id: string;
  label_key: string | null;
  jurisdiction_codes: string[];
  status: CatalogueStatus;
}

/** CMP-001 catalogue read port. Tenant-scoped, published metadata only; no cross-component SQL. */
export interface CataloguePort {
  getVersion(input: {
    tenantId: string;
    catalogueVersionId: string;
  }): Promise<CatalogueVersionPin | null>;
  getEntries(input: {
    tenantId: string;
    catalogueVersionId: string;
    serviceIds: string[];
  }): Promise<CatalogueEntry[]>;
}
