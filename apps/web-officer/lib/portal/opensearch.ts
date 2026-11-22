import { openSearchMirrorLabel } from '@serviceform/m10-sample-lab/m08-ops-catalogue';

export interface PlatformOpenSearchStatus {
  mode: string;
  simulation?: string;
  real_deferred: boolean;
  document_count: number;
  last_sync_at: string | null;
  topic?: string;
  simulator_version?: string;
  opensearch_connector_type_in_contract?: boolean;
  certified?: boolean;
  g6_issued?: boolean;
}

export interface PortalOpenSearchCard {
  label: string;
  mode: string;
  document_count: number;
  last_sync_at: string | null;
  real_deferred: true;
  non_authoritative: true;
}

export function toOpenSearchCard(status: PlatformOpenSearchStatus): PortalOpenSearchCard {
  return {
    label: openSearchMirrorLabel(status),
    mode: status.mode,
    document_count: status.document_count,
    last_sync_at: status.last_sync_at,
    real_deferred: true,
    non_authoritative: true,
  };
}
