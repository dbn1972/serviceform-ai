import { opsViewLabel } from '@serviceform/m10-sample-lab/m08-ops-catalogue';

export interface PlatformOpsView {
  view_code: string;
  source_component: string;
  status: string;
  stale: boolean;
  max_age_seconds: number;
  as_of: string | null;
  metrics: readonly {
    metric_code: string;
    value: number;
    dimensions?: Record<string, string | number | boolean>;
  }[];
  non_authoritative: boolean;
}

export interface PortalOpsViewCard {
  view_code: string;
  label: string;
  source_component: string;
  status: string;
  stale: boolean;
  as_of: string | null;
  metrics: readonly {
    metric_code: string;
    value: number;
    dimensions_summary: string;
  }[];
  non_authoritative: true;
  can_refresh: boolean;
}

function dimensionsSummary(
  dimensions: Record<string, string | number | boolean> | undefined,
): string {
  if (!dimensions) return '';
  return Object.entries(dimensions)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
}

export function toOpsViewCard(row: PlatformOpsView): PortalOpsViewCard {
  return {
    view_code: row.view_code,
    label: opsViewLabel(row.view_code),
    source_component: row.source_component,
    status: row.status,
    stale: row.stale,
    as_of: row.as_of,
    metrics: (row.metrics ?? []).map((m) => ({
      metric_code: m.metric_code,
      value: m.value,
      dimensions_summary: dimensionsSummary(m.dimensions),
    })),
    non_authoritative: true,
    can_refresh: true,
  };
}
