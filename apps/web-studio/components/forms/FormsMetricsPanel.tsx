'use client';

import { Card } from '@serviceform/ui-ux4g';
import {
  type DurableKpiSeries,
  buildLabHostDurableSeries,
} from '@serviceform/forms-product-metrics/durable-kpi-series';
import { getBrowserProductMetricEvents } from '@serviceform/forms-product-metrics/browser-product-metrics';
import {
  buildDurableKpiSnapshot,
  type DurableKpiSnapshot,
} from '@serviceform/forms-product-metrics/aggregate-product-metrics';
import { useMemo, useState } from 'react';

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function ms(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)} ms`;
}

/**
 * Durable forms KPI panel (P8-1 / D7). Aggregate-only; no PII dimensions.
 * Prefers live browser ring events when present; otherwise SAMPLE_LAB host series.
 */
export function FormsMetricsPanel() {
  const [labSeries] = useState<DurableKpiSeries>(() => buildLabHostDurableSeries().series);

  const liveSnapshot: DurableKpiSnapshot | null = useMemo(() => {
    const events = getBrowserProductMetricEvents();
    if (events.length < 4) return null;
    return buildDurableKpiSnapshot(events, { source: 'browser' });
  }, []);

  const snapshot = liveSnapshot ?? labSeries.snapshot;
  const usingLive = liveSnapshot !== null;

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        Forms product KPIs — Studio authoring time, citizen completion/abandon, form load/submit
        p95, a11y score capture, and zero cross-tenant incidents. Aggregates only; raw answers and
        person fields are forbidden. CERTIFIED=false · DigiLocker out of scope.
      </p>
      <div className="sf-tag-row">
        <span className="ux4g-tag-tonal-primary">
          source · {usingLive ? 'browser live' : 'lab_host_series'}
        </span>
        <span className="ux4g-tag-outline-neutral">events · {snapshot.event_count}</span>
        <span className="ux4g-tag-outline-warning">CERTIFIED=false</span>
        <span
          className={snapshot.cross_tenant.ok ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-error'}
        >
          {snapshot.cross_tenant.smoke_invariant}
        </span>
      </div>

      <div className="sf-designer-start">
        <Card title="Citizen funnel" subtitle="Start → complete / abandon (no PII)">
          <dl className="sf-stack">
            <div>
              <dt className="ux4g-label-s-default">Starts</dt>
              <dd className="ux4g-heading-xl-strong">{snapshot.funnel.starts}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Completes</dt>
              <dd className="ux4g-heading-xl-strong">{snapshot.funnel.completes}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Abandons</dt>
              <dd className="ux4g-heading-xl-strong">{snapshot.funnel.abandons}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Completion rate</dt>
              <dd className="ux4g-body-m-default">{pct(snapshot.funnel.completion_rate)}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Latency p95" subtitle="Form load / submit">
          <dl className="sf-stack">
            <div>
              <dt className="ux4g-label-s-default">Load p95</dt>
              <dd className="ux4g-heading-xl-strong">{ms(snapshot.form_load.p95_ms)}</dd>
              <dd className="ux4g-body-s-default">n={snapshot.form_load.sample_size}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Submit p95</dt>
              <dd className="ux4g-heading-xl-strong">{ms(snapshot.form_submit.p95_ms)}</dd>
              <dd className="ux4g-body-s-default">n={snapshot.form_submit.sample_size}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Studio authoring" subtitle="Designer session duration">
          <dl className="sf-stack">
            <div>
              <dt className="ux4g-label-s-default">Sessions</dt>
              <dd className="ux4g-heading-xl-strong">{snapshot.authoring.sessions}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Duration p95</dt>
              <dd className="ux4g-heading-xl-strong">{ms(snapshot.authoring.duration_p95_ms)}</dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Completed / left</dt>
              <dd className="ux4g-body-m-default">
                {snapshot.authoring.completed} / {snapshot.authoring.abandoned}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="A11y + tenancy" subtitle="Score capture · zero cross-tenant KPI">
          <dl className="sf-stack">
            <div>
              <dt className="ux4g-label-s-default">Latest a11y score</dt>
              <dd className="ux4g-heading-xl-strong">
                {snapshot.a11y.latest_score === null ? '—' : snapshot.a11y.latest_score}
              </dd>
              <dd className="ux4g-body-s-default">
                captures={snapshot.a11y.captures} · violations={snapshot.a11y.total_violations}
              </dd>
            </div>
            <div>
              <dt className="ux4g-label-s-default">Cross-tenant incidents</dt>
              <dd className="ux4g-heading-xl-strong">{snapshot.cross_tenant.incident_count}</dd>
              <dd className="ux4g-body-s-default">target 0 · {snapshot.cross_tenant.kpi_id}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {!usingLive ? (
        <Card
          title="Durable p95 series"
          subtitle={`${labSeries.window_count} SAMPLE_LAB windows (not synthetic-only n=40)`}
        >
          <div className="sf-table-wrap">
            <table className="sf-table">
              <caption>Lab-host latency and funnel by window</caption>
              <thead>
                <tr>
                  <th scope="col">Window</th>
                  <th scope="col">Started</th>
                  <th scope="col">Load p95</th>
                  <th scope="col">Submit p95</th>
                  <th scope="col">Completes</th>
                  <th scope="col">Abandons</th>
                </tr>
              </thead>
              <tbody>
                {labSeries.series.map((row) => (
                  <tr key={row.window_id}>
                    <th scope="row">{row.window_id}</th>
                    <td className="sf-nowrap">{row.started_at}</td>
                    <td>{ms(row.form_load_p95_ms)}</td>
                    <td>{ms(row.form_submit_p95_ms)}</td>
                    <td>{row.completes}</td>
                    <td>{row.abandons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
