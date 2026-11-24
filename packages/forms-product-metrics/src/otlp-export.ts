/**
 * OTLP-shaped metrics export for forms product KPIs (CMP-047 adjacent).
 * Pure JSON transform — does NOT import @serviceform/observability or OTEL Node SDKs
 * (keeps web apps deps:graph-safe via forms-product-metrics only).
 */

import type { DurableKpiSnapshot } from './aggregate-product-metrics';
import type { DurableKpiSeries } from './durable-kpi-series';
import { ZERO_CROSS_TENANT_KPI } from './product-metrics';

export interface OtlpNumberDataPoint {
  readonly asInt?: string;
  readonly asDouble?: number;
  readonly timeUnixNano: string;
  readonly attributes: readonly { key: string; value: { stringValue: string } }[];
}

export interface OtlpMetric {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly gauge?: { dataPoints: readonly OtlpNumberDataPoint[] };
  readonly sum?: {
    dataPoints: readonly OtlpNumberDataPoint[];
    aggregationTemporality: 2;
    isMonotonic: boolean;
  };
}

export interface OtlpMetricsExport {
  readonly resourceMetrics: readonly {
    resource: {
      attributes: readonly { key: string; value: { stringValue: string } }[];
    };
    scopeMetrics: readonly {
      scope: { name: string; version: string };
      metrics: readonly OtlpMetric[];
    }[];
  }[];
  readonly CERTIFIED: false;
  readonly raw_pii_payload_forbidden: true;
}

function nanoFromIso(iso: string): string {
  const ms = Date.parse(iso);
  const safe = Number.isFinite(ms) ? ms : Date.now();
  return `${BigInt(safe) * 1_000_000n}`;
}

function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

function gauge(
  name: string,
  description: string,
  unit: string,
  value: number,
  timeUnixNano: string,
  extra: { key: string; value: { stringValue: string } }[] = [],
): OtlpMetric {
  const isInt = Number.isInteger(value);
  const point: OtlpNumberDataPoint = {
    timeUnixNano,
    attributes: [attr('sf.aggregate_only', 'true'), attr('sf.pii_forbidden', 'true'), ...extra],
    ...(isInt ? { asInt: String(value) } : { asDouble: value }),
  };
  return { name, description, unit, gauge: { dataPoints: [point] } };
}

/**
 * Map a durable KPI snapshot (+ optional series) to OTLP metrics JSON.
 * Dimension values are category codes / numbers only.
 */
export function exportDurableKpisToOtlp(
  snapshot: DurableKpiSnapshot,
  series?: DurableKpiSeries,
): OtlpMetricsExport {
  const t = nanoFromIso(snapshot.generated_at);
  const metrics: OtlpMetric[] = [
    gauge(
      'sf.forms.funnel.starts',
      'Citizen/studio journey starts (aggregate)',
      '1',
      snapshot.funnel.starts,
      t,
    ),
    gauge(
      'sf.forms.funnel.completes',
      'Citizen form completes (aggregate)',
      '1',
      snapshot.funnel.completes,
      t,
    ),
    gauge(
      'sf.forms.funnel.abandons',
      'Citizen form abandons before complete (aggregate)',
      '1',
      snapshot.funnel.abandons,
      t,
    ),
    gauge(
      'sf.forms.funnel.completion_rate',
      'Completion rate 0-1 (aggregate)',
      '1',
      Number(snapshot.funnel.completion_rate.toFixed(4)),
      t,
    ),
    gauge(
      'sf.forms.latency.load_p95_ms',
      'Citizen form load p95',
      'ms',
      snapshot.form_load.p95_ms ?? 0,
      t,
      [attr('sample_size', String(snapshot.form_load.sample_size))],
    ),
    gauge(
      'sf.forms.latency.submit_p95_ms',
      'Citizen form submit p95',
      'ms',
      snapshot.form_submit.p95_ms ?? 0,
      t,
      [attr('sample_size', String(snapshot.form_submit.sample_size))],
    ),
    gauge(
      'sf.forms.authoring.duration_p95_ms',
      'Studio authoring duration p95',
      'ms',
      snapshot.authoring.duration_p95_ms ?? 0,
      t,
      [attr('sessions', String(snapshot.authoring.sessions))],
    ),
    gauge(
      'sf.forms.a11y.score',
      'Latest a11y score capture (0-100)',
      '1',
      snapshot.a11y.latest_score ?? 0,
      t,
      [attr('violations', String(snapshot.a11y.total_violations))],
    ),
    gauge(
      'sf.forms.cross_tenant.incidents',
      ZERO_CROSS_TENANT_KPI.definition,
      '1',
      snapshot.cross_tenant.incident_count,
      t,
      [
        attr('kpi_id', ZERO_CROSS_TENANT_KPI.kpi_id),
        attr('smoke_invariant', ZERO_CROSS_TENANT_KPI.smoke_invariant),
      ],
    ),
  ];

  if (series) {
    for (const point of series.series) {
      const wt = nanoFromIso(point.started_at);
      metrics.push(
        gauge(
          'sf.forms.latency.load_p95_ms.window',
          'Per-window form load p95',
          'ms',
          point.form_load_p95_ms ?? 0,
          wt,
          [attr('window_id', point.window_id)],
        ),
        gauge(
          'sf.forms.latency.submit_p95_ms.window',
          'Per-window form submit p95',
          'ms',
          point.form_submit_p95_ms ?? 0,
          wt,
          [attr('window_id', point.window_id)],
        ),
      );
    }
  }

  return {
    CERTIFIED: false,
    raw_pii_payload_forbidden: true,
    resourceMetrics: [
      {
        resource: {
          attributes: [
            attr('service.name', 'serviceform-forms-product-metrics'),
            attr('sf.surface', 'forms_kpi'),
            attr('sf.source', snapshot.source),
            attr('sf.certified', 'false'),
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: '@serviceform/forms-product-metrics',
              version: '0.0.0',
            },
            metrics,
          },
        ],
      },
    ],
  };
}

/** Serialize OTLP export as a single line-safe JSON string (no PII keys). */
export function otlpExportJson(exportDoc: OtlpMetricsExport): string {
  const text = JSON.stringify(exportDoc);
  if (/\b(mobile|aadhaar|email|password|otp|access_token|form_data)\b/i.test(text)) {
    throw new Error('OTLP_EXPORT_PII_LEAK');
  }
  return text;
}
