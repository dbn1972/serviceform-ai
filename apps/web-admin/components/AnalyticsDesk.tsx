'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    await fetch('/api/platform/lab/m08/ensure', { method: 'POST' }).catch(() => undefined);
    const res = await fetch('/api/platform/analytics/metric-definitions', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as a tenant admin or ops analyst session.');
      setLoaded(true);
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
      setLoaded(true);
      return;
    }
    setDefs(body.definitions ?? body.items ?? []);
    setLoaded(true);
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
        Published metric definitions only. Aggregates never carry person-level fields. Search
        indexing remains a SIMULATED lab mirror until a REAL connector is bound.
      </p>
      {error ? (
        <Alert variant="error" title="Analytics failed">
          {error}
        </Alert>
      ) : null}
      <div className="sf-actions">
        <Button variant="outline-primary" disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Refreshing…' : 'Refresh definitions'}
        </Button>
      </div>
      {!loaded ? (
        <p className="ux4g-body-m-default" aria-busy="true">
          Loading definitions…
        </p>
      ) : defs.length === 0 ? (
        <section className="sf-empty" aria-label="Analytics empty">
          <h2 className="ux4g-heading-l-strong">No definitions yet</h2>
          <p className="ux4g-body-m-default">
            Lab ensure seeds LAB_CASE_TRANSITIONS when the analytics mirror is empty. Refresh after
            ensure completes.
          </p>
          <div className="sf-actions">
            <Button variant="outline-primary" disabled={busy} onClick={() => void refresh()}>
              Refresh definitions
            </Button>
          </div>
        </section>
      ) : (
        <ul className="sf-list" aria-label="Metric definitions">
          {defs.map((d) => (
            <li key={d.definition_id}>
              <Card title={d.metric_code} subtitle={`${d.status} · ${d.purpose_code}`}>
                <p className="ux4g-body-m-default">
                  Aggregation {d.aggregation} · period {d.period_granularity}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
