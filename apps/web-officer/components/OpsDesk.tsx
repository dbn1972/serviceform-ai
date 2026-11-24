'use client';

import { useCallback, useEffect, useState } from 'react';

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

export function OpsDesk() {
  const [views, setViews] = useState<OpsViewCard[]>([]);
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
      return;
    }
    const body = (await res.json()) as {
      views?: OpsViewCard[];
      overall_status?: string;
      message?: string;
    };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load ops views');
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
        setViews((prev) => prev.map((v) => (v.view_code === viewCode ? refreshed : v)));
      } else {
        await load();
      }
      await loadMirror();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        CMP-046 operational views — richer owner-shaped aggregates plus SIMULATED OpenSearch mirror
        (REAL deferred). Never owns case decisions. CERTIFIED=false · G6=false.
      </p>

      {overall ? (
        <p className="ux4g-body-s-default">
          Overall status: <strong>{overall}</strong>
        </p>
      ) : null}

      {mirror ? (
        <div className="sf-meta-row" aria-label="OpenSearch mirror">
          <strong>{mirror.label}</strong>
          <span className="ux4g-tag-outline-warning">{mirror.mode}</span>
          <span className="ux4g-tag-outline-neutral">REAL deferred</span>
        </div>
      ) : null}

      {error ? (
        <div className="ux4g-alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <ul className="sf-list" aria-label="Ops views">
        {views.map((view) => (
          <li key={view.view_code}>
            <div className="sf-meta-row">
              <strong>{view.label}</strong>
              <span className="ux4g-tag-outline-neutral">{view.status}</span>
              {view.stale ? <span className="ux4g-tag-outline-warning">stale</span> : null}
            </div>
            <div className="ux4g-body-s-default">
              Source {view.source_component}
              {view.as_of ? ` · as of ${view.as_of}` : ''} · non-authoritative
            </div>
            <ul>
              {view.metrics.map((m, i) => (
                <li key={`${m.metric_code}-${i}`}>
                  {m.metric_code}: {m.value}
                  {m.dimensions_summary ? ` (${m.dimensions_summary})` : ''}
                </li>
              ))}
            </ul>
            <div className="sf-actions">
              <button
                type="button"
                className="ux4g-btn-outline-primary ux4g-btn-m"
                disabled={busy || !view.can_refresh}
                onClick={() => void refresh(view.view_code)}
              >
                Refresh
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
