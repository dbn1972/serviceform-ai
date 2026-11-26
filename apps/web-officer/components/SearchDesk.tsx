'use client';

import { Alert, Button, Card, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';
import { EmptyState } from './EmptyState';

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
  const [searched, setSearched] = useState(false);
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
      setSearched(true);
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
        Find cases by catalogue, state, or opaque application ref. Results are projections only —
        never authoritative. No PII in facets.
      </p>

      {mirrorCount !== null ? (
        <p className="ux4g-body-s-default" aria-label="OpenSearch mirror count">
          Search mirror (simulated): {mirrorCount} docs
        </p>
      ) : null}

      {error ? (
        <Alert variant="error" title="Search">
          {error}
        </Alert>
      ) : null}

      <Card
        title="Case search"
        footer={
          <Button disabled={busy} onClick={() => void runSearch()}>
            {busy ? 'Searching…' : 'Search cases'}
          </Button>
        }
      >
        <div className="sf-form-stack" role="search" aria-label="Case search">
          <TextInput
            id="search-catalogue"
            label="Catalogue id"
            value={catalogueId}
            onChange={(e) => setCatalogueId(e.target.value)}
            placeholder="IND-SOC-002"
            optional
          />
          <TextInput
            id="search-state"
            label="Case state"
            value={caseState}
            onChange={(e) => setCaseState(e.target.value)}
            placeholder="IN_SCRUTINY"
            optional
          />
          <TextInput
            id="search-ref"
            label="Application ref"
            value={applicationRef}
            onChange={(e) => setApplicationRef(e.target.value)}
            placeholder="lab-app:residence-1"
            optional
          />
        </div>
      </Card>

      <p className="ux4g-body-s-default" aria-live="polite">
        {searched
          ? `${hits.length} projection hit${hits.length === 1 ? '' : 's'}`
          : 'Run a search to see projection hits.'}
      </p>

      {!searched ? (
        <EmptyState title="No search yet" icon="document" testId="search-empty-idle">
          Enter facets above and search. Lab projections appear here when available.
        </EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState
          title="No matching projections"
          icon="document"
          actionLabel="Search again"
          onAction={() => void runSearch()}
          actionBusy={busy}
          testId="search-empty-zero"
        >
          No projection hits for these facets. Try another catalogue id or application ref.
        </EmptyState>
      ) : (
        <ul className="sf-list" aria-label="Search results">
          {hits.map((hit) => (
            <li key={hit.document_id}>
              <strong>{hit.label}</strong>
              <div className="ux4g-body-s-default">
                {hit.document_id.slice(0, 8)}… · non-authoritative
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
          ))}
        </ul>
      )}
    </div>
  );
}
