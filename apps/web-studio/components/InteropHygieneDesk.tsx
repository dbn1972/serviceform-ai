'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';

type CatalogueSummary = {
  bpmn_fixtures: readonly {
    fixture_id: string;
    label: string;
    expect_supported: boolean;
  }[];
  sfpackage: { label: string };
  migration_scenarios: readonly { scenario_id: string; label: string; mode: string }[];
};

type SuiteResult = {
  ok: boolean;
  bpmn: { ok: boolean }[];
  sfpackage: {
    ok: boolean;
    secrets_detected: boolean;
    signature_ref_external: boolean;
  };
  migration: { ok: boolean }[];
  certified: false;
  g6: false;
  note?: string;
};

/**
 * SAMPLE_LAB interop hygiene desk: BPMN profile · .sfpackage · migration dry-run.
 * Client fetches Studio BFF only — never imports @serviceform/m10-sample-lab (node:fs/crypto).
 * Temporal remains the only runtime. No Camunda. CERTIFIED=false · G6=false.
 */
export function InteropHygieneDesk() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [catalogue, setCatalogue] = useState<CatalogueSummary | null>(null);
  const [suite, setSuite] = useState<SuiteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/lab/interop/catalogue', { cache: 'no-store' });
        const body = (await res.json()) as CatalogueSummary & { message?: string };
        if (!res.ok) {
          if (!cancelled) setError(body.message ?? 'Failed to load interop catalogue');
          return;
        }
        if (!cancelled) setCatalogue(body);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load interop catalogue');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function prove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/lab/interop/prove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
      });
      const body = (await res.json()) as SuiteResult & { message?: string };
      if (!res.ok && !body.ok) {
        setError(body.message ?? 'Interop hygiene prove failed');
      }
      setSuite(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Interop hygiene prove failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <Alert variant="info" title="Lab interop hygiene only">
        Temporal remains the durable runtime. BPMN is an import/export profile (
        <code className="sf-hash">isExecutable=&quot;false&quot;</code>). Signed{' '}
        <code className="sf-hash">.sfpackage</code> manifests forbid embedded secrets. In-flight
        migration is dry-run + maker-checker only — never silent. CERTIFIED=false · G6=false.
      </Alert>

      <Card
        title="Catalogue seeds"
        subtitle={
          catalogue
            ? `${catalogue.bpmn_fixtures.length} BPMN fixtures · 1 .sfpackage · ${catalogue.migration_scenarios.length} migration scenarios`
            : 'Loading SAMPLE_LAB catalogue…'
        }
      >
        {catalogue ? (
          <ul className="ux4g-body-s-default">
            {catalogue.bpmn_fixtures.map((f) => (
              <li key={f.fixture_id}>
                BPMN · {f.label} · expect {f.expect_supported ? 'SUPPORTED' : 'UNSUPPORTED'}
              </li>
            ))}
            <li>.sfpackage · {catalogue.sfpackage.label}</li>
            {catalogue.migration_scenarios.map((s) => (
              <li key={s.scenario_id}>
                Migration · {s.label} · mode {s.mode}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ux4g-body-s-default">Waiting for catalogue BFF…</p>
        )}
      </Card>

      <div className="sf-actions">
        <Button disabled={busy} onClick={() => void prove()}>
          {busy ? 'Proving…' : 'Prove interop hygiene'}
        </Button>
      </div>

      {error ? (
        <Alert variant="error" title="Prove failed">
          {error}
        </Alert>
      ) : null}

      {suite ? (
        <Card
          title={suite.ok ? 'Hygiene prove passed' : 'Hygiene prove incomplete'}
          subtitle={`Camunda forbidden · Temporal runtime · certified=${String(suite.certified)} · g6=${String(suite.g6)}`}
        >
          <dl className="ux4g-body-s-default">
            <dt>BPMN fixtures</dt>
            <dd data-testid="interop-bpmn-count">
              {suite.bpmn.filter((r) => r.ok).length}/{suite.bpmn.length} matched expectations
            </dd>
            <dt>.sfpackage</dt>
            <dd data-testid="interop-sfpackage-ok">
              {suite.sfpackage.ok ? 'valid' : 'invalid'} · secrets_detected=
              {String(suite.sfpackage.secrets_detected)} · signature_external=
              {String(suite.sfpackage.signature_ref_external)}
            </dd>
            <dt>Migration dry-runs</dt>
            <dd data-testid="interop-migration-count">
              {suite.migration.filter((r) => r.ok).length}/{suite.migration.length} · applied always
              false
            </dd>
          </dl>
          {suite.note ? <p className="ux4g-body-s-default">{suite.note}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
