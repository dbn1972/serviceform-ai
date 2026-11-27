'use client';

import { Button, Icon, Select } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SAMPLE_LAB_PRIVACY_REQUEST_TYPES,
  SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES,
} from '@serviceform/m10-sample-lab/privacy-catalogue';
import { FormAlert } from './FormFeedback';

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

function retentionPeriodLabel(status: string): string {
  if (status === 'UNBOUND' || status === 'unbound') return 'Not yet set by the department';
  return status.replaceAll('_', ' ').toLowerCase();
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

  const requestTypeOptions = useMemo(
    () => SAMPLE_LAB_PRIVACY_REQUEST_TYPES.map((t) => ({ value: t.code, label: t.label })),
    [],
  );
  const scopeOptions = useMemo(
    () =>
      SAMPLE_LAB_PRIVACY_SCOPE_TEMPLATES.map((s) => ({
        value: `${s.owner_component}|${s.scope_ref}`,
        label: s.label,
      })),
    [],
  );

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
          Review how your data is used, see retention posture, and submit a rights request. Officers
          fulfil changes — this centre does not decide eligibility.
        </p>
      </section>

      <FormAlert tone="info" title="Sample lab environment">
        This portal runs in SAMPLE_LAB. It is not a production privacy desk.
      </FormAlert>

      {error ? (
        <FormAlert tone="error">
          {error}{' '}
          {error.includes('Sign in') ? (
            <Link href="/login" className="ux4g-text-link-m">
              Sign in
            </Link>
          ) : null}
        </FormAlert>
      ) : null}

      <section aria-labelledby="purposes-heading">
        <h2 id="purposes-heading" className="ux4g-heading-l-strong">
          Published purposes
        </h2>
        {purposes.length === 0 ? (
          <section className="sf-empty" aria-labelledby="purposes-empty">
            <h3 id="purposes-empty" className="ux4g-heading-s-strong">
              No published purposes yet
            </h3>
            <p className="ux4g-body-m-default">
              Purposes appear here when the department publishes them.
            </p>
          </section>
        ) : (
          <ul className="sf-stack">
            {purposes.map((p) => (
              <li key={p.purpose_id} className="ux4g-body-m-default">
                <strong>{p.label}</strong>
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
          To withdraw consent, submit a rights request below and choose consent withdrawal.
        </p>
        {consents.length === 0 ? (
          <section className="sf-empty" aria-labelledby="consents-empty">
            <h3 id="consents-empty" className="ux4g-heading-s-strong">
              No consents on record
            </h3>
            <p className="ux4g-body-m-default">Consents for this account will show here.</p>
          </section>
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
            <ul className="sf-stack">
              {retention.entries.map((e) => (
                <li key={`${e.owner_component}:${e.resource_kind}`} className="ux4g-body-m-default">
                  {e.resource_kind.replaceAll('_', ' ')} · period{' '}
                  {retentionPeriodLabel(e.period_ref_status)} · {e.eligibility}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <section className="sf-empty" aria-labelledby="retention-empty">
            <h3 id="retention-empty" className="ux4g-heading-s-strong">
              Retention details unavailable
            </h3>
            <p className="ux4g-body-m-default">Try again later, or contact the helpdesk.</p>
          </section>
        )}
      </section>

      <section aria-labelledby="request-heading">
        <h2 id="request-heading" className="ux4g-heading-l-strong">
          Submit a rights request
        </h2>
        <form className="sf-stack" onSubmit={(e) => void submit(e)}>
          <Select
            id="privacy-request-type"
            label="Request type"
            value={requestType}
            options={requestTypeOptions}
            onChange={(e) => setRequestType(e.target.value)}
            required
          />
          <Select
            id="privacy-scope"
            label="What this request covers"
            value={scopeKey}
            options={scopeOptions}
            onChange={(e) => setScopeKey(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </form>
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="ux4g-heading-l-strong">
          My privacy requests
        </h2>
        {requests.length === 0 ? (
          <section className="sf-empty" aria-labelledby="privacy-requests-empty">
            <span className="sf-service-mark">
              <Icon name="document" size={24} />
            </span>
            <h3 id="privacy-requests-empty" className="ux4g-heading-s-strong">
              No privacy requests yet
            </h3>
            <p className="ux4g-body-m-default">Submit a rights request above to get started.</p>
          </section>
        ) : (
          <ul className="sf-stack">
            {requests.map((r) => (
              <li key={r.request_id}>
                <Button
                  type="button"
                  variant="text-neutral"
                  size="s"
                  onClick={() => setSelected(r)}
                >
                  {r.request_type_label} · {r.status_label} · scope {r.scope_count}
                </Button>
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
            Status: {selected.status_label} · reference {selected.request_id.slice(0, 8)}…
          </p>
          {selected.can_withdraw ? (
            <Button
              type="button"
              variant="outline-neutral"
              disabled={busy}
              onClick={() => void withdraw()}
            >
              Withdraw request
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
