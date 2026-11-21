'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  SAMPLE_LAB_ASSISTED_CHANNELS,
  SAMPLE_LAB_ASSISTED_CONSENT,
  SAMPLE_LAB_ASSISTED_ASSURANCE,
  channelRequiresAuthority,
  type AssistedSessionView,
  toAssistedSessionView,
} from '../lib/portal/assisted';

type Step = 'start' | 'bind' | 'consent' | 'verify' | 'apply' | 'done';

export function AssistedApplyShell() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<AssistedSessionView | null>(null);
  const [channel, setChannel] = useState('CSC');
  const [appliedFor, setAppliedFor] = useState('');
  const [authorityRef, setAuthorityRef] = useState('');
  const [readBack, setReadBack] = useState(false);
  const [consentRef, setConsentRef] = useState('');
  const [catalogueId, setCatalogueId] = useState('IND-SOC-002');
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('start');

  const refresh = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/portal/assisted/sessions/${sessionId}`, { cache: 'no-store' });
    const body = (await res.json()) as Record<string, unknown> & { message?: string };
    if (!res.ok) {
      setError(body.message ?? 'Unable to load assisted session');
      return null;
    }
    const view =
      (body['portal'] as AssistedSessionView | undefined) ?? toAssistedSessionView(body);
    if (view) setSession(view);
    return view;
  }, []);

  useEffect(() => {
    void fetch('/api/portal/assisted/catalogue', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as {
        catalogue?: { default_channel?: string; default_offering_catalogue_id?: string };
      };
      if (body.catalogue?.default_channel) setChannel(body.catalogue.default_channel);
      if (body.catalogue?.default_offering_catalogue_id) {
        setCatalogueId(body.catalogue.default_offering_catalogue_id);
      }
    });
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/assisted/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel,
          applied_for_citizen_id: appliedFor.trim(),
        }),
      });
      const body = (await res.json()) as Record<string, unknown> & { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Start refused');
        return;
      }
      const view = toAssistedSessionView(body);
      if (!view) {
        setError('Malformed session response');
        return;
      }
      setSession(view);
      setConsentRef(`${SAMPLE_LAB_ASSISTED_CONSENT.consent_ref_prefix}/${view.session_id.slice(0, 8)}`);
      setStep('bind');
    } finally {
      setBusy(false);
    }
  }

  async function bind() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/assisted/sessions/${session.session_id}/bind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expected_version: session.session_version,
          applicant_assurance_ref: SAMPLE_LAB_ASSISTED_ASSURANCE.default_ref,
        }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Bind refused');
        return;
      }
      await refresh(session.session_id);
      setStep('consent');
    } finally {
      setBusy(false);
    }
  }

  async function captureAndVerify() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        expected_version: session.session_version,
        consent_ref: consentRef,
        read_back_acknowledged: readBack,
        representation_authority_ref: channelRequiresAuthority(session.channel)
          ? authorityRef
          : null,
      };
      const res = await fetch(`/api/portal/assisted/sessions/${session.session_id}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Consent / representation refused (fail-closed)');
        return;
      }
      await refresh(session.session_id);
      setStep('apply');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/assisted/sessions/${session.session_id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogue_id: catalogueId }),
      });
      const body = (await res.json()) as {
        message?: string;
        application_id?: string;
      };
      if (!res.ok) {
        setError(body.message ?? 'Assisted apply refused');
        return;
      }
      setApplicationId(body.application_id ?? null);
      await refresh(session.session_id);
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-stack">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Assisted apply</h1>
        <p className="ux4g-body-m-default">
          CSC / counter shell: operator stays <code>applied_by</code>, citizen stays{' '}
          <code>applied_for</code>, with representation basis and fail-closed consent. Operators
          never impersonate citizens (Constitution #36). SAMPLE_LAB · CERTIFIED=false · G6=false.
        </p>
      </section>

      {error ? (
        <p className="ux4g-body-m-default" role="alert">
          {error}{' '}
          {error.toLowerCase().includes('sign in') ? (
            <Link href="/login" className="ux4g-link">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}

      {session ? (
        <section aria-labelledby="proof-heading" className="sf-stack">
          <h2 id="proof-heading" className="ux4g-heading-l-strong">
            Session proof
          </h2>
          <dl className="ux4g-body-m-default">
            <div>
              <dt>Channel</dt>
              <dd>{session.channel}</dd>
            </div>
            <div>
              <dt>applied_by (operator)</dt>
              <dd>
                <code>{session.applied_by_actor_id}</code>
              </dd>
            </div>
            <div>
              <dt>applied_for (citizen)</dt>
              <dd>
                <code>{session.applied_for_citizen_id}</code>
              </dd>
            </div>
            <div>
              <dt>Distinct</dt>
              <dd>{session.applied_by_distinct_from_applied_for ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>{session.lifecycle_status}</dd>
            </div>
            <div>
              <dt>Impersonation</dt>
              <dd>forbidden</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {step === 'start' ? (
        <section aria-labelledby="start-heading" className="sf-stack">
          <h2 id="start-heading" className="ux4g-heading-l-strong">
            1. Start CSC / assisted session
          </h2>
          <label className="ux4g-body-m-default" htmlFor="channel">
            Channel
            <select
              id="channel"
              className="ux4g-select"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {SAMPLE_LAB_ASSISTED_CHANNELS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ux4g-body-m-default" htmlFor="applied-for">
            Citizen applied_for (UUID)
            <input
              id="applied-for"
              className="ux4g-input"
              value={appliedFor}
              onChange={(e) => setAppliedFor(e.target.value)}
              placeholder="Citizen subject UUID from CMP-004"
              autoComplete="off"
            />
          </label>
          <p className="ux4g-body-s-default">
            You remain signed in as the operator. Do not paste a citizen session token.
          </p>
          <button
            type="button"
            className="ux4g-btn-filled-primary"
            disabled={busy || !appliedFor.trim()}
            onClick={() => void start()}
          >
            Start session
          </button>
        </section>
      ) : null}

      {step === 'bind' && session ? (
        <section aria-labelledby="bind-heading" className="sf-stack">
          <h2 id="bind-heading" className="ux4g-heading-l-strong">
            2. Bind applicant assurance
          </h2>
          <p className="ux4g-body-m-default">
            Opaque assurance ref: <code>{SAMPLE_LAB_ASSISTED_ASSURANCE.default_ref}</code>
          </p>
          <button
            type="button"
            className="ux4g-btn-filled-primary"
            disabled={busy}
            onClick={() => void bind()}
          >
            Bind applicant
          </button>
        </section>
      ) : null}

      {(step === 'consent' || step === 'verify') && session ? (
        <section aria-labelledby="consent-heading" className="sf-stack">
          <h2 id="consent-heading" className="ux4g-heading-l-strong">
            3. Consent + representation (fail-closed)
          </h2>
          <p className="ux4g-body-m-default">{SAMPLE_LAB_ASSISTED_CONSENT.label}</p>
          <label className="ux4g-body-m-default" htmlFor="consent-ref">
            Consent ref
            <input
              id="consent-ref"
              className="ux4g-input"
              value={consentRef}
              onChange={(e) => setConsentRef(e.target.value)}
            />
          </label>
          {channelRequiresAuthority(session.channel) ? (
            <label className="ux4g-body-m-default" htmlFor="authority-ref">
              Representation authority ref (opaque)
              <input
                id="authority-ref"
                className="ux4g-input"
                value={authorityRef}
                onChange={(e) => setAuthorityRef(e.target.value)}
                placeholder="authority:… (owner-supplied; no statute)"
              />
            </label>
          ) : (
            <p className="ux4g-body-s-default">
              Channel {session.channel} uses the assisted channel itself as basis; no separate
              authority ref required.
            </p>
          )}
          <label className="ux4g-body-m-default" htmlFor="read-back">
            <input
              id="read-back"
              type="checkbox"
              checked={readBack}
              onChange={(e) => setReadBack(e.target.checked)}
            />{' '}
            Citizen read-back acknowledged (required — fail-closed without it)
          </label>
          <button
            type="button"
            className="ux4g-btn-filled-primary"
            disabled={busy || !readBack}
            onClick={() => void captureAndVerify()}
          >
            Capture consent &amp; verify
          </button>
        </section>
      ) : null}

      {step === 'apply' && session ? (
        <section aria-labelledby="apply-heading" className="sf-stack">
          <h2 id="apply-heading" className="ux4g-heading-l-strong">
            4. File assisted application
          </h2>
          <p className="ux4g-body-m-default">
            Creates a draft owned by <code>applied_for</code> via server-mediated filing, then links
            it on the assisted session. Your officer session is never swapped to the citizen.
          </p>
          <label className="ux4g-body-m-default" htmlFor="catalogue">
            Offering catalogue id
            <input
              id="catalogue"
              className="ux4g-input"
              value={catalogueId}
              onChange={(e) => setCatalogueId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ux4g-btn-filled-primary"
            disabled={busy}
            onClick={() => void apply()}
          >
            File application
          </button>
        </section>
      ) : null}

      {step === 'done' ? (
        <section aria-labelledby="done-heading" className="sf-stack">
          <h2 id="done-heading" className="ux4g-heading-l-strong">
            Assisted apply linked
          </h2>
          <p className="ux4g-body-m-default">
            Application <code>{applicationId ?? session?.application_id}</code> is owned by the
            citizen (<code>applied_for</code>). Operator proof remains on the assisted session.
          </p>
          {applicationId ? (
            <Link href={`/applications/${applicationId}`} className="ux4g-link">
              Open application
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
