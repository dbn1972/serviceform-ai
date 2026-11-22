'use client';

import { useCallback, useEffect, useState } from 'react';

interface MetricDefinition {
  definition_id: string;
  metric_code: string;
  status: string;
  purpose_code: string;
  aggregation: string;
  period_granularity: string;
}

export function AnalyticsDesk() {
  const [defs, setDefs] = useState<MetricDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    await fetch('/api/platform/lab/m08/ensure', { method: 'POST' }).catch(() => undefined);
    const res = await fetch('/api/platform/analytics/metric-definitions', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as TENANT_ADMIN_STUDIO or SAMPLE_LAB_OPS_ANALYST.');
      return;
    }
    const body = (await res.json()) as {
      definitions?: MetricDefinition[];
      items?: MetricDefinition[];
      error_code?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'Unable to load metric definitions');
      return;
    }
    setDefs(body.definitions ?? body.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        CMP-045 Analytics &amp; MIS — published metric definitions only. Aggregates never carry
        person-level fields. INT-010 OpenSearch path remains SIMULATED lab mirror (REAL deferred).
        CERTIFIED=false · G6=false.
      </p>
      {error ? (
        <div className="ux4g-alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="sf-actions">
        <button
          type="button"
          className="ux4g-btn-secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? 'Refreshing…' : 'Refresh definitions'}
        </button>
      </div>
      <ul className="sf-list" aria-label="Metric definitions">
        {defs.length === 0 ? (
          <li className="ux4g-body-m-default">
            No definitions yet. Lab ensure seeds LAB_CASE_TRANSITIONS.
          </li>
        ) : (
          defs.map((d) => (
            <li key={d.definition_id}>
              <strong>{d.metric_code}</strong> · {d.status} · {d.aggregation}/{d.period_granularity}{' '}
              · purpose {d.purpose_code}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
