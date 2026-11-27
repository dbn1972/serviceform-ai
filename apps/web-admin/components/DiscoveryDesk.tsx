'use client';

import { Alert, Button, Card, Select, TextInput } from '@serviceform/ui-ux4g';
import { useState } from 'react';

interface DiscoveryResult {
  service_id: string;
  service_code?: string;
  service_binding_version_id?: string;
  available?: boolean;
}

/** Labels are jurisdiction codes only — never hard-coded place names (Constitution #3). */
const JURISDICTION_OPTIONS = [
  { value: 'IN-OD-SAMPLE-LAB', label: 'IN-OD-SAMPLE-LAB' },
  { value: 'IN-SAMPLE-LAB', label: 'IN-SAMPLE-LAB' },
] as const;

export function DiscoveryDesk() {
  const [keywords, setKeywords] = useState('Residence');
  const [jurisdiction, setJurisdiction] = useState<string>(JURISDICTION_OPTIONS[0].value);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
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
            jurisdiction_codes: [jurisdiction],
            keywords: keywords.trim() ? [keywords.trim()] : [],
          },
          pagination: { limit: 20, offset: 0 },
        }),
      });
      if (res.status === 401) {
        setError('Sign in as a tenant admin or ops analyst session.');
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
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <p className="ux4g-body-m-default">
        Browse published catalogue offers for a jurisdiction. Results are non-statutory availability
        hints — never eligibility or approval decisions.
      </p>
      {error ? (
        <Alert variant="error" title="Discovery failed">
          {error}
        </Alert>
      ) : null}
      <TextInput
        id="discovery-keywords"
        label="Keywords"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="Residence"
        hint="Match against published offer labels in the sample catalogue."
      />
      <Select
        id="discovery-jurisdiction"
        label="Jurisdiction"
        options={JURISDICTION_OPTIONS}
        value={jurisdiction}
        onChange={(e) => setJurisdiction(e.target.value)}
      />
      <div className="sf-actions">
        <Button disabled={busy} onClick={() => void runQuery()}>
          {busy ? 'Searching…' : 'Discover services'}
        </Button>
      </div>
      {queryId ? (
        <p className="ux4g-body-s-default">Query {queryId} · result is non-statutory</p>
      ) : null}
      {!searched ? (
        <section className="sf-empty" aria-label="Discovery idle">
          <h2 className="ux4g-heading-l-strong">Run a search</h2>
          <p className="ux4g-body-m-default">
            Enter keywords and choose a jurisdiction, then discover published offers.
          </p>
        </section>
      ) : results.length === 0 ? (
        <section className="sf-empty" aria-label="Discovery empty">
          <h2 className="ux4g-heading-l-strong">No matching offers</h2>
          <p className="ux4g-body-m-default">
            No published services matched those keywords in the selected jurisdiction. Try a broader
            term or another jurisdiction.
          </p>
        </section>
      ) : (
        <ul className="sf-list" aria-label="Discovery results">
          {results.map((r) => (
            <li key={r.service_id}>
              <Card title={r.service_code ?? r.service_id}>
                <p className="ux4g-body-m-default">
                  {r.service_binding_version_id
                    ? `Binding ${r.service_binding_version_id.slice(0, 8)}…`
                    : 'No binding pin on result'}
                  {r.available === false ? ' · unavailable' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
