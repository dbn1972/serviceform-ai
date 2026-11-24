'use client';

import { Card } from '@serviceform/ui-ux4g';
import { buildLabHostDurableSeries } from '@serviceform/forms-product-metrics/durable-kpi-series';
import { useMemo } from 'react';

/**
 * Read-only Admin view of forms product KPIs (P8-1).
 * Consumes web-safe @serviceform/forms-product-metrics only — never packages/observability.
 */
export function FormsKpiDesk() {
  const series = useMemo(() => buildLabHostDurableSeries().series, []);
  const snap = series.snapshot;

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        Read-only forms measure desk. Funnel, latency p95 series, authoring, a11y, and
        CROSS_TENANT_LEAKAGE=0. No person-level fields. CERTIFIED=false · DigiLocker out of scope.
      </p>
      <div className="sf-tag-row">
        <span className="ux4g-tag-tonal-primary">source · {snap.source}</span>
        <span className="ux4g-tag-outline-neutral">windows · {series.window_count}</span>
        <span className={snap.cross_tenant.ok ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-error'}>
          cross-tenant · {snap.cross_tenant.incident_count}
        </span>
      </div>
      <Card title="Summary" subtitle="Aggregate-only SAMPLE_LAB series">
        <ul className="sf-list" aria-label="Forms KPI summary">
          <li>
            Funnel: {snap.funnel.completes} complete / {snap.funnel.abandons} abandon of{' '}
            {snap.funnel.starts} starts ({(snap.funnel.completion_rate * 100).toFixed(1)}%
            completion)
          </li>
          <li>
            Load p95: {snap.form_load.p95_ms ?? '—'} ms (n={snap.form_load.sample_size})
          </li>
          <li>
            Submit p95: {snap.form_submit.p95_ms ?? '—'} ms (n={snap.form_submit.sample_size})
          </li>
          <li>
            Authoring sessions: {snap.authoring.sessions}; duration p95:{' '}
            {snap.authoring.duration_p95_ms ?? '—'} ms
          </li>
          <li>
            A11y latest score: {snap.a11y.latest_score ?? '—'} (violations{' '}
            {snap.a11y.total_violations})
          </li>
          <li>
            Zero cross-tenant KPI: {snap.cross_tenant.ok ? 'PASS' : 'FAIL'} (
            {snap.cross_tenant.smoke_invariant})
          </li>
        </ul>
      </Card>
    </div>
  );
}
