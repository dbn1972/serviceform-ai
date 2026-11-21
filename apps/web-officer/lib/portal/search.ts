import { searchHitLabel } from '@serviceform/m10-sample-lab/m08-ops-catalogue';

export interface PlatformSearchHit {
  document: {
    document_id: string;
    source_cmp_id: string;
    source_record_id: string;
    facets: Record<string, string | number | boolean>;
  };
  source: {
    aggregate_type: string;
    event_type: string;
    occurred_at: string;
  };
  revision: number;
}

export interface PortalSearchHitCard {
  document_id: string;
  source_cmp_id: string;
  source_record_id: string;
  label: string;
  catalogue_id: string | null;
  case_state: string | null;
  application_ref: string | null;
  occurred_at: string;
  non_authoritative: true;
}

export function toSearchHitCard(hit: PlatformSearchHit): PortalSearchHitCard {
  const facets = hit.document.facets ?? {};
  return {
    document_id: hit.document.document_id,
    source_cmp_id: hit.document.source_cmp_id,
    source_record_id: hit.document.source_record_id,
    label: searchHitLabel(facets),
    catalogue_id: typeof facets['catalogue_id'] === 'string' ? facets['catalogue_id'] : null,
    case_state: typeof facets['case_state'] === 'string' ? facets['case_state'] : null,
    application_ref:
      typeof facets['application_ref'] === 'string' ? facets['application_ref'] : null,
    occurred_at: hit.source.occurred_at,
    non_authoritative: true,
  };
}

export function buildSearchBody(input: {
  catalogue_id?: string;
  case_state?: string;
  application_ref?: string;
  limit?: number;
}): Record<string, unknown> {
  const facets: Record<string, string> = {};
  if (input.catalogue_id?.trim()) facets['catalogue_id'] = input.catalogue_id.trim();
  if (input.case_state?.trim()) facets['case_state'] = input.case_state.trim();
  if (input.application_ref?.trim()) facets['application_ref'] = input.application_ref.trim();
  return {
    source_cmp_id: 'CMP-015',
    facets,
    limit: input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20,
  };
}
