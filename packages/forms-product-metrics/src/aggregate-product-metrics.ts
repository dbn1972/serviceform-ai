/**
 * PII-safe aggregation over product-metric events for durable KPI panels.
 * Counts and percentiles only — never form answers or person fields.
 */

import { ZERO_CROSS_TENANT_KPI, p95, percentile, type ProductMetricEvent } from './product-metrics';

export interface FunnelKpi {
  readonly starts: number;
  readonly completes: number;
  readonly abandons: number;
  /** Completes / max(starts, 1) as 0–1 ratio. */
  readonly completion_rate: number;
  /** Abandons / max(starts, 1) as 0–1 ratio. */
  readonly abandon_rate: number;
}

export interface LatencyKpi {
  readonly sample_size: number;
  readonly p50_ms: number | null;
  readonly p95_ms: number | null;
  readonly max_ms: number | null;
}

export interface AuthoringKpi {
  readonly sessions: number;
  readonly completed: number;
  readonly abandoned: number;
  readonly duration_p50_ms: number | null;
  readonly duration_p95_ms: number | null;
  readonly milestones: Readonly<Record<string, number>>;
}

export interface A11yKpi {
  readonly captures: number;
  readonly latest_score: number | null;
  readonly min_score: number | null;
  readonly total_violations: number;
}

export interface CrossTenantKpi {
  readonly incident_count: number;
  readonly target: 0;
  readonly ok: boolean;
  readonly smoke_invariant: typeof ZERO_CROSS_TENANT_KPI.smoke_invariant;
  readonly kpi_id: typeof ZERO_CROSS_TENANT_KPI.kpi_id;
}

export interface DurableKpiSnapshot {
  readonly CERTIFIED: false;
  readonly g6_issued: false;
  readonly self_certified: false;
  readonly aggregate_only: true;
  readonly raw_pii_payload_forbidden: true;
  readonly generated_at: string;
  readonly source: 'browser' | 'lab_host_series' | 'lab_synthetic' | 'mixed';
  readonly event_count: number;
  readonly funnel: FunnelKpi;
  readonly form_load: LatencyKpi;
  readonly form_submit: LatencyKpi;
  readonly authoring: AuthoringKpi;
  readonly a11y: A11yKpi;
  readonly cross_tenant: CrossTenantKpi;
}

function samplesOf(
  events: readonly ProductMetricEvent[],
  code: ProductMetricEvent['metric_code'],
): number[] {
  return events.filter((e) => e.metric_code === code).map((e) => e.value);
}

function latencyOf(
  events: readonly ProductMetricEvent[],
  code: 'CITIZEN_FORM_LOAD_MS' | 'CITIZEN_FORM_SUBMIT_MS',
): LatencyKpi {
  const samples = samplesOf(events, code).filter((n) => Number.isFinite(n) && n >= 0);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    sample_size: samples.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: p95(samples),
    max_ms: sorted.length ? (sorted[sorted.length - 1] ?? null) : null,
  };
}

export function aggregateFunnel(events: readonly ProductMetricEvent[]): FunnelKpi {
  const starts = events.filter(
    (e) =>
      e.metric_code === 'CITIZEN_FORM_LOAD_MS' ||
      e.metric_code === 'STUDIO_AUTHORING_SESSION_START',
  ).length;
  const completes = events.filter(
    (e) => e.metric_code === 'CITIZEN_FORM_COMPLETE' && e.value === 1,
  ).length;
  const abandons = events.filter(
    (e) => e.metric_code === 'CITIZEN_FORM_ABANDON' && e.value === 1,
  ).length;
  const denom = Math.max(starts, 1);
  return {
    starts,
    completes,
    abandons,
    completion_rate: completes / denom,
    abandon_rate: abandons / denom,
  };
}

export function aggregateAuthoring(events: readonly ProductMetricEvent[]): AuthoringKpi {
  const sessions = events.filter((e) => e.metric_code === 'STUDIO_AUTHORING_SESSION_START').length;
  const durations = events.filter((e) => e.metric_code === 'STUDIO_AUTHORING_DURATION_MS');
  const completed = durations.filter((e) => e.dimensions['outcome'] === 'COMPLETE').length;
  const abandoned = durations.filter(
    (e) => e.dimensions['outcome'] === 'ABANDON' || e.dimensions['outcome'] === 'LEAVE',
  ).length;
  const durationValues = durations.map((e) => e.value);
  const sorted = [...durationValues].sort((a, b) => a - b);
  const milestones: Record<string, number> = {};
  for (const e of events) {
    if (e.metric_code !== 'STUDIO_AUTHORING_MILESTONE') continue;
    const m = String(e.dimensions['milestone'] ?? 'UNCLASSIFIED');
    milestones[m] = (milestones[m] ?? 0) + 1;
  }
  return {
    sessions,
    completed,
    abandoned,
    duration_p50_ms: percentile(sorted, 50),
    duration_p95_ms: p95(durationValues),
    milestones,
  };
}

export function aggregateA11y(events: readonly ProductMetricEvent[]): A11yKpi {
  const captures = events.filter((e) => e.metric_code === 'A11Y_SCORE_CAPTURE');
  const scores = captures.map((e) => e.value);
  const total_violations = captures.reduce((sum, e) => {
    const v = e.dimensions['violations'];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);
  return {
    captures: captures.length,
    latest_score: scores.length ? (scores[scores.length - 1] ?? null) : null,
    min_score: scores.length ? Math.min(...scores) : null,
    total_violations,
  };
}

export function aggregateCrossTenant(events: readonly ProductMetricEvent[]): CrossTenantKpi {
  const incident_count = events
    .filter((e) => e.metric_code === 'CROSS_TENANT_INCIDENT')
    .reduce((sum, e) => sum + e.value, 0);
  return {
    incident_count,
    target: 0,
    ok: incident_count === 0,
    smoke_invariant: ZERO_CROSS_TENANT_KPI.smoke_invariant,
    kpi_id: ZERO_CROSS_TENANT_KPI.kpi_id,
  };
}

export function buildDurableKpiSnapshot(
  events: readonly ProductMetricEvent[],
  opts?: { source?: DurableKpiSnapshot['source']; generated_at?: string },
): DurableKpiSnapshot {
  return {
    CERTIFIED: false,
    g6_issued: false,
    self_certified: false,
    aggregate_only: true,
    raw_pii_payload_forbidden: true,
    generated_at: opts?.generated_at ?? new Date().toISOString(),
    source: opts?.source ?? 'mixed',
    event_count: events.length,
    funnel: aggregateFunnel(events),
    form_load: latencyOf(events, 'CITIZEN_FORM_LOAD_MS'),
    form_submit: latencyOf(events, 'CITIZEN_FORM_SUBMIT_MS'),
    authoring: aggregateAuthoring(events),
    a11y: aggregateA11y(events),
    cross_tenant: aggregateCrossTenant(events),
  };
}

/** Assert snapshot JSON never contains forbidden PII key substrings. */
export function assertSnapshotPiiSafe(snapshot: DurableKpiSnapshot): void {
  const blob = JSON.stringify(snapshot);
  if (/\b(mobile|aadhaar|email|password|otp|access_token)\b/i.test(blob)) {
    throw new Error('KPI_SNAPSHOT_PII_LEAK');
  }
}
