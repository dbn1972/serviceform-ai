'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from './EmptyState';

interface OpsViewCard {
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

interface OpenSearchMirrorCard {
  label: string;
  mode: string;
  document_count: number;
  last_sync_at: string | null;
  real_deferred: true;
}

function metricLabel(code: string): string {
  return code
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function OpsDesk() {
  const [views, setViews] = useState<OpsViewCard[] | null>(null);
  const [overall, setOverall] = useState<string | null>(null);
  const [mirror, setMirror] = useState<OpenSearchMirrorCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadMirror = useCallback(async () => {
    const res = await fetch('/api/portal/ops/opensearch', { cache: 'no-store' });
    if (!res.ok) {
      setMirror(null);
      return;
    }
    const body = (await res.json()) as { mirror?: OpenSearchMirrorCard };
    setMirror(body.mirror ?? null);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/portal/ops', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in as a SAMPLE_LAB case or ops officer to open ops.');
      setViews([]);
      return;
    }
    const body = (await res.json()) as {
      views?: OpsViewCard[];
      overall_status?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load ops views');
      setViews([]);
      return;
    }
    setViews(body.views ?? []);
    setOverall(typeof body.overall_status === 'string' ? body.overall_status : null);
    await loadMirror();
  }, [loadMirror]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh(viewCode: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/ops/${viewCode}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json()) as { view?: OpsViewCard; message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Refresh refused');
        return;
      }
      const refreshed = body.view;
      if (refreshed) {
        setViews((prev) => (prev ?? []).map((v) => (v.view_code === viewCode ? refreshed : v)));
      } else {
        await load();
      }
      await loadMirror();
    } finally {
      setBusy(false);
    }
  }

  if (views === null) {
    return (
      <p className="ux4g-body-m-default" aria-busy="true">
        Loading ops views…
      </p>
    );
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        Workload and health aggregates beyond a single queue. Views are non-authoritative and never
        own case decisions.
      </p>

      {overall ? (
        <div className="sf-meta-row" aria-label="Overall ops status">
          <span className="ux4g-tag-tonal-primary">Overall · {overall}</span>
        </div>
      ) : null}

      {mirror ? (
        <Card title={mirror.label} subtitle="Search mirror · simulated">
          <dl className="sf-mini-stats">
            <div>
              <dt>Documents</dt>
              <dd>{mirror.document_count}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{mirror.mode}</dd>
            </div>
          </dl>
          {mirror.last_sync_at ? (
            <p className="ux4g-body-s-default">Last sync {mirror.last_sync_at}</p>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Alert variant="error" title="Ops dashboard">
          {error}
        </Alert>
      ) : null}

      {views.length === 0 ? (
        <EmptyState
          title="No ops views yet"
          icon="layers"
          actionLabel="Refresh"
          onAction={() => void load()}
          actionBusy={busy}
          testId="ops-empty"
        >
          Operational aggregates appear here after the lab ops catalogue is seeded.
        </EmptyState>
      ) : (
        <div className="sf-stack" aria-label="Ops views">
          {views.map((view) => (
            <Card
              key={view.view_code}
              title={view.label}
              subtitle={
                view.as_of ? `As of ${view.as_of} · non-authoritative` : 'Non-authoritative'
              }
              footer={
                <Button
                  variant="outline-primary"
                  disabled={busy || !view.can_refresh}
                  onClick={() => void refresh(view.view_code)}
                >
                  Refresh
                </Button>
              }
            >
              <div className="sf-meta-row">
                <span className="ux4g-tag-outline-neutral">{view.status}</span>
                {view.stale ? <span className="ux4g-tag-outline-warning">Stale</span> : null}
              </div>
              {view.metrics.length === 0 ? (
                <p className="ux4g-body-m-default">No metrics in this refresh yet.</p>
              ) : (
                <dl className="sf-mini-stats">
                  {view.metrics.map((m, i) => (
                    <div key={`${m.metric_code}-${i}`}>
                      <dt>
                        {metricLabel(m.metric_code)}
                        {m.dimensions_summary ? ` · ${m.dimensions_summary}` : ''}
                      </dt>
                      <dd>{m.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
