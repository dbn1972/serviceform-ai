/** One ranked candidate from the CMP-035 projection; it names a catalogue service only. */
export interface SearchCandidate {
  tenant_id: string;
  service_id: string;
}

/**
 * CMP-035 search read port (tenant-safe projection). The adapter maps these filters to CMP-035
 * facets; results are candidates that CMP-006 re-verifies against the pinned catalogue.
 */
export interface SearchPort {
  searchServices(input: {
    tenantId: string;
    catalogueVersionId: string;
    jurisdictionCodes: string[];
    serviceCodes: string[];
    keywords: string[];
    limit: number;
    offset: number;
  }): Promise<SearchCandidate[]>;
}
