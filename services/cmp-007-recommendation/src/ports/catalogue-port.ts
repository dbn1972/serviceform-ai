export interface CatalogueCandidate {
  tenantId: string;
  serviceId: string;
  serviceCode: string;
  categoryCode: string | null;
  publishedVersionRef: string;
  status: 'PUBLISHED' | 'DRAFT' | 'RETIRED';
}

/**
 * CMP-001 catalogue read port (published services only, tenant-scoped). No cross-component SQL.
 * Only coded, non-personal catalogue attributes cross this port.
 */
export interface CataloguePort {
  resolve(input: { tenantId: string; serviceIds: string[] }): Promise<CatalogueCandidate[]>;
  listPublished(input: { tenantId: string; limit: number }): Promise<CatalogueCandidate[]>;
}
