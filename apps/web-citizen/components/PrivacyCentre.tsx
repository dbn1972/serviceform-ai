'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
  SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
} from '@serviceform/m10-sample-lab/privacy-catalogue';

interface PortalConsent {
  consent_id: string;
  purpose_code: string | null;
  purpose_label: string | null;
  status: string;
  status_label: string;
  granted_at: string;
  withdrawn_at: string | null;
}

interface PortalRequest {
  request_id: string;
  request_type: string;
  request_type_label: string;
  lifecycle_status: string;
  status_label: string;
  scope_count: number;
  can_withdraw: boolean;
}

interface RetentionEntry {
  owner_component: string;
  resource_kind: string;
  period_ref_status: string;
  eligibility: string;
}

interface RetentionView {
  visibility: string;
  invented_statutory_period_forbidden: boolean;
  citizen_archive_delete_forbidden: boolean;
  note: string;
  entries: RetentionEntry[];
}

interface PurposeView {
  purpose_id: string;
  code: string;
  label: string;
  status: string;
  requires_consent: boolean;
}

export function PrivacyCentre() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<PortalConsent[]>([]);
  const [purposes, setPurposes] = useState<PurposeView[]>([]);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [retention, setRetention] = useState<RetentionView | null>(null);
  const [requestType, setRequestType] = useState<string>('ACCESS');
  const [scopeKey, setScopeKey] = useState<string>(
    `${SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES[0].owner_component}|${SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES[0].scope_ref}`,
  );
  const [selected, setSelected] = useState<PortalRequest | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/portal/privacy', { cache: 'no-store' });
    if (res.status === 401) {
      setError('Sign in to view your privacy centre.');
      return;
    }
    const body = (await res.json()) as {
      message?: string;
      consents?: PortalConsent[];
      purposes?: PurposeView[];
      requests?: PortalRequest[];
      retention?: RetentionView;
    };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load privacy centre');
      return;
    }
    setConsents(body.consents ?? []);
    setPurposes(body.purposes ?? []);
    setRequests(body.requests ?? []);
    setRetention(body.retention ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [owner_component, scope_ref] = scopeKey.split('|');
      const res = await fetch('/api/portal/privacy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_type: requestType,
          scope: [{ owner_component, scope_ref }],
        }),
      });
      const body = (await res.json()) as { message?: string; request?: PortalRequest };
      if (!res.ok) {
        setError(body.message ?? 'Could not submit privacy request');
        return;
      }
      if (body.request) setSelected(body.request);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/privacy/requests/${selected.request_id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'WITHDRAW' }),
      });
      const body = (await res.json()) as { message?: string; request?: PortalRequest };
      if (!res.ok) {
        setError(body.message ?? 'Withdraw refused');
        return;
      }
      if (body.request) setSelected(body.request);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Privacy centre</h1>
        <p className="ux4g-body-m-default">
          View consent and purpose use, retention posture, and submit data-rights requests. Owning
          services fulfil changes — this centre does not invent statute, purge foreign tables, or
          decide eligibility. SAMPLE_LAB · CERTIFIED=false · G6=false.
        </p>
      </section>

      {error ? (
        <p className="ux4g-body-m-default" role="alert">
          {error}{' '}
          {error.includes('Sign in') ? (
            <Link href="/login" className="ux4g-text-link-m">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}

      <section aria-labelledby="purposes-heading">
        <h2 id="purposes-heading" className="ux4g-heading-l-strong">
          Published purposes
        </h2>
        {purposes.length === 0 ? (
          <p className="ux4g-body-m-default">No published purposes visible yet.</p>
        ) : (
          <ul className="sf-stack">
            {purposes.map((p) => (
              <li key={p.purpose_id} className="ux4g-body-m-default">
                <strong>{p.code}</strong> — {p.label}
                {p.requires_consent ? ' · requires consent' : ''} · {p.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="consents-heading">
        <h2 id="consents-heading" className="ux4g-heading-l-strong">
          Your consents
        </h2>
        <p className="ux4g-body-s-default">
          Consent history is owned by CMP-030. Withdrawal is requested through a privacy rights
          request (CONSENT_WITHDRAWAL) — direct withdraw is not citizen-granted.
        </p>
        {consents.length === 0 ? (
          <p className="ux4g-body-m-default">No consents on record for this account.</p>
        ) : (
          <ul className="sf-stack">
            {consents.map((c) => (
              <li key={c.consent_id} className="ux4g-body-m-default">
                {(c.purpose_label ?? c.purpose_code ?? 'Purpose') + ' · ' + c.status_label}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="retention-heading">
        <h2 id="retention-heading" className="ux4g-heading-l-strong">
          Retention posture
        </h2>
        {retention ? (
          <>
            <p className="ux4g-body-m-default">{retention.note}</p>
            <p className="ux4g-body-s-default">
              Visibility: {retention.visibility}
              {retention.invented_statutory_period_forbidden
                ? ' · invented statutory period forbidden'
                : ''}
              {retention.citizen_archive_delete_forbidden
                ? ' · citizen archive/delete forbidden'
                : ''}
            </p>
            <ul className="sf-stack">
              {retention.entries.map((e) => (
                <li key={`${e.owner_component}:${e.resource_kind}`} className="ux4g-body-m-default">
                  {e.owner_component} / {e.resource_kind} · period {e.period_ref_status} ·{' '}
                  {e.eligibility}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ux4g-body-m-default">Retention catalogue unavailable.</p>
        )}
      </section>

      <section aria-labelledby="request-heading">
        <h2 id="request-heading" className="ux4g-heading-l-strong">
          Submit a rights request
        </h2>
        <form className="sf-stack" onSubmit={(e) => void submit(e)}>
          <label className="ux4g-label-m-default">
            Request type
            <select
              className="ux4g-select"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              required
            >
              {SAMPLE_LAB_PRIVACY_REQUEST_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ux4g-label-m-default">
            Scope (published template)
            <select
              className="ux4g-select"
              value={scopeKey}
              onChange={(e) => setScopeKey(e.target.value)}
              required
            >
              {SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES.map((s) => (
                <option
                  key={`${s.owner_component}|${s.scope_ref}`}
                  value={`${s.owner_component}|${s.scope_ref}`}
                >
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ux4g-btn-primary ux4g-btn-m" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="ux4g-heading-l-strong">
          My privacy requests
        </h2>
        {requests.length === 0 ? (
          <p className="ux4g-body-m-default">No privacy requests yet.</p>
        ) : (
          <ul className="sf-stack">
            {requests.map((r) => (
              <li key={r.request_id}>
                <button
                  type="button"
                  className="ux4g-btn-text-neutral ux4g-btn-s"
                  onClick={() => setSelected(r)}
                >
                  {r.request_type_label} · {r.status_label} · scope {r.scope_count}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section
          aria-labelledby="detail-heading"
          className="ux4g-card"
          data-extension="consent-privacy-card"
        >
          <h2 id="detail-heading" className="ux4g-heading-l-strong">
            {selected.request_type_label}
          </h2>
          <p className="ux4g-body-m-default">
            Status: {selected.status_label} · id {selected.request_id.slice(0, 8)}…
          </p>
          {selected.can_withdraw ? (
            <button
              type="button"
              className="ux4g-btn-outline-neutral ux4g-btn-m"
              disabled={busy}
              onClick={() => void withdraw()}
            >
              Withdraw request
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
