'use client';

import { useState } from 'react';

interface SearchHitCard {
  document_id: string;
  source_cmp_id: string;
  source_record_id: string;
  label: string;
  catalogue_id: string | null;
  case_state: string | null;
  application_ref: string | null;
  occurred_at: string;
  non_authoritative: true;
}

export function SearchDesk() {
  const [catalogueId, setCatalogueId] = useState('');
  const [caseState, setCaseState] = useState('');
  const [applicationRef, setApplicationRef] = useState('');
  const [hits, setHits] = useState<SearchHitCard[]>([]);
  const [mirrorCount, setMirrorCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogue_id: catalogueId.trim() || undefined,
          case_state: caseState.trim() || undefined,
          application_ref: applicationRef.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        setError('Sign in as a SAMPLE_LAB case or ops officer to search.');
        return;
      }
      const body = (await res.json()) as { hits?: SearchHitCard[]; message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Search refused');
        return;
      }
      setHits(body.hits ?? []);
      const mirrorRes = await fetch('/api/portal/ops/opensearch', { cache: 'no-store' });
      if (mirrorRes.ok) {
        const mirrorBody = (await mirrorRes.json()) as {
          mirror?: { document_count?: number };
        };
        setMirrorCount(
          typeof mirrorBody.mirror?.document_count === 'number'
            ? mirrorBody.mirror.document_count
            : null,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        CMP-035 projections only — find cases by opaque facets. OpenSearch lab mirror is SIMULATED
        (REAL deferred). Never authoritative; no PII in facets. CERTIFIED=false · G6=false.
      </p>

      {mirrorCount !== null ? (
        <p className="ux4g-body-s-default" aria-label="OpenSearch mirror count">
          OpenSearch mirror (SIMULATED): {mirrorCount} docs · REAL deferred
        </p>
      ) : null}

      {error ? (
        <div className="ux4g-alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="sf-form-grid" role="search" aria-label="Case search">
        <label className="ux4g-label-m-default" htmlFor="search-catalogue">
          Catalogue id
          <input
            id="search-catalogue"
            className="ux4g-input"
            value={catalogueId}
            onChange={(e) => setCatalogueId(e.target.value)}
            placeholder="IND-SOC-002"
          />
        </label>
        <label className="ux4g-label-m-default" htmlFor="search-state">
          Case state
          <input
            id="search-state"
            className="ux4g-input"
            value={caseState}
            onChange={(e) => setCaseState(e.target.value)}
            placeholder="IN_SCRUTINY"
          />
        </label>
        <label className="ux4g-label-m-default" htmlFor="search-ref">
          Application ref
          <input
            id="search-ref"
            className="ux4g-input"
            value={applicationRef}
            onChange={(e) => setApplicationRef(e.target.value)}
            placeholder="lab-app:residence-1"
          />
        </label>
      </div>

      <div className="sf-actions">
        <button
          type="button"
          className="ux4g-btn-primary ux4g-btn-m"
          disabled={busy}
          onClick={() => void runSearch()}
        >
          {busy ? 'Searching…' : 'Search cases'}
        </button>
      </div>

      <p className="ux4g-body-s-default" aria-live="polite">
        {hits.length} projection hit{hits.length === 1 ? '' : 's'}
      </p>

      <ul className="sf-list" aria-label="Search results">
        {hits.length === 0 ? (
          <li className="ux4g-body-m-default">
            No projection hits yet. Run a search or seed lab ensure.
          </li>
        ) : (
          hits.map((hit) => (
            <li key={hit.document_id}>
              <strong>{hit.label}</strong>
              <div className="ux4g-body-s-default">
                {hit.source_cmp_id} · {hit.document_id.slice(0, 8)}… · non-authoritative
              </div>
              <div className="sf-meta-row">
                {hit.catalogue_id ? (
                  <span className="ux4g-tag-outline-neutral">{hit.catalogue_id}</span>
                ) : null}
                {hit.case_state ? (
                  <span className="ux4g-tag-outline-neutral">{hit.case_state}</span>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
