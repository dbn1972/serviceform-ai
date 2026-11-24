'use client';

import { useState } from 'react';

interface DiscoveryResult {
  service_id: string;
  service_code?: string;
  service_binding_version_id?: string;
  available?: boolean;
}

export function DiscoveryDesk() {
  const [keywords, setKeywords] = useState('Residence');
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runQuery() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/platform/lab/m08/ensure', { method: 'POST' }).catch(() => undefined);
      const res = await fetch('/api/platform/discovery/queries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          catalogue_version_id: '0d15ba00-0c08-4000-8000-0d15ba000c08',
          filters: {
            jurisdiction_codes: ['IN-OD-SAMPLE-LAB'],
            keywords: keywords.trim() ? [keywords.trim()] : [],
          },
          pagination: { limit: 20, offset: 0 },
        }),
      });
      if (res.status === 401) {
        setError('Sign in as TENANT_ADMIN_STUDIO or SAMPLE_LAB_OPS_ANALYST.');
        return;
      }
      const body = (await res.json()) as {
        query_id?: string;
        query?: { query_id?: string };
        results?: DiscoveryResult[];
        items?: DiscoveryResult[];
        error_code?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? body.error_code ?? 'Discovery refused');
        return;
      }
      setQueryId(body.query_id ?? body.query?.query_id ?? null);
      setResults(body.results ?? body.items ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        CMP-006 service discovery — jurisdiction-aware catalogue browse. Results are non-statutory
        availability hints, never eligibility decisions. CERTIFIED=false · G6=false.
      </p>
      {error ? (
        <div className="ux4g-alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <label className="ux4g-label-m-default" htmlFor="discovery-keywords">
        Keywords
        <input
          id="discovery-keywords"
          className="ux4g-input"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Residence"
        />
      </label>
      <div className="sf-actions">
        <button
          type="button"
          className="ux4g-btn-primary ux4g-btn-m"
          disabled={busy}
          onClick={() => void runQuery()}
        >
          {busy ? 'Searching…' : 'Discover services'}
        </button>
      </div>
      {queryId ? (
        <p className="ux4g-body-s-default">Query {queryId} · result_is_non_statutory</p>
      ) : null}
      <ul className="sf-list" aria-label="Discovery results">
        {results.length === 0 ? (
          <li className="ux4g-body-m-default">No discovery hits yet.</li>
        ) : (
          results.map((r) => (
            <li key={r.service_id}>
              <strong>{r.service_code ?? r.service_id}</strong>
              {r.service_binding_version_id
                ? ` · binding ${r.service_binding_version_id.slice(0, 8)}…`
                : ''}
              {r.available === false ? ' · unavailable' : ''}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
