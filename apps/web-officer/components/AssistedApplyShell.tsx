'use client';

import { Alert, Button, Card, Checkbox, Select, TextInput, TextLink } from '@serviceform/ui-ux4g';
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
    const view = (body['portal'] as AssistedSessionView | undefined) ?? toAssistedSessionView(body);
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
      setConsentRef(
        `${SAMPLE_LAB_ASSISTED_CONSENT.consent_ref_prefix}/${view.session_id.slice(0, 8)}`,
      );
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
          Help a citizen file an application at a CSC or counter. You stay the operator; the citizen
          remains the applicant. Never impersonate.
        </p>
      </section>

      {error ? (
        <Alert variant="error" title="Assisted session">
          {error}{' '}
          {error.toLowerCase().includes('sign in') ? (
            <TextLink href="/login">Sign in</TextLink>
          ) : null}
        </Alert>
      ) : null}

      {session ? (
        <Card title="Session proof" subtitle="Operator and citizen stay distinct">
          <dl className="sf-dl">
            <dt>Channel</dt>
            <dd>{session.channel}</dd>
            <dt>Operator</dt>
            <dd>
              <code>{session.applied_by_actor_id}</code>
            </dd>
            <dt>Citizen account</dt>
            <dd>
              <code>{session.applied_for_citizen_id}</code>
            </dd>
            <dt>Distinct parties</dt>
            <dd>{session.applied_by_distinct_from_applied_for ? 'Yes' : 'No'}</dd>
            <dt>Lifecycle</dt>
            <dd>{session.lifecycle_status}</dd>
          </dl>
        </Card>
      ) : null}

      {step === 'start' ? (
        <Card
          title="1. Start assisted session"
          footer={
            <Button disabled={busy || !appliedFor.trim()} onClick={() => void start()}>
              {busy ? 'Starting…' : 'Start session'}
            </Button>
          }
        >
          <div className="sf-form-stack">
            <Select
              id="channel"
              label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              options={SAMPLE_LAB_ASSISTED_CHANNELS.map((c) => ({
                value: c.code,
                label: c.label,
              }))}
            />
            <TextInput
              id="applied-for"
              label="Citizen account id"
              value={appliedFor}
              onChange={(e) => setAppliedFor(e.target.value)}
              placeholder="Citizen subject UUID"
              autoComplete="off"
              hint="You remain signed in as the operator. Do not paste a citizen session token."
            />
          </div>
        </Card>
      ) : null}

      {step === 'bind' && session ? (
        <Card
          title="2. Bind applicant assurance"
          footer={
            <Button disabled={busy} onClick={() => void bind()}>
              {busy ? 'Binding…' : 'Bind applicant'}
            </Button>
          }
        >
          <p className="ux4g-body-m-default">
            Opaque assurance ref: <code>{SAMPLE_LAB_ASSISTED_ASSURANCE.default_ref}</code>
          </p>
        </Card>
      ) : null}

      {(step === 'consent' || step === 'verify') && session ? (
        <Card
          title="3. Consent and representation"
          footer={
            <Button disabled={busy || !readBack} onClick={() => void captureAndVerify()}>
              {busy ? 'Verifying…' : 'Capture consent & verify'}
            </Button>
          }
        >
          <div className="sf-form-stack">
            <p className="ux4g-body-m-default">{SAMPLE_LAB_ASSISTED_CONSENT.label}</p>
            <TextInput
              id="consent-ref"
              label="Consent ref"
              value={consentRef}
              onChange={(e) => setConsentRef(e.target.value)}
            />
            {channelRequiresAuthority(session.channel) ? (
              <TextInput
                id="authority-ref"
                label="Representation authority ref"
                value={authorityRef}
                onChange={(e) => setAuthorityRef(e.target.value)}
                placeholder="authority:… (owner-supplied; no statute)"
                hint="Opaque reference only."
              />
            ) : (
              <p className="ux4g-body-s-default">
                Channel {session.channel} uses the assisted channel itself as basis; no separate
                authority ref required.
              </p>
            )}
            <Checkbox
              id="read-back"
              label="Citizen read-back acknowledged"
              description="Required — fail-closed without it"
              checked={readBack}
              onChange={(e) => setReadBack(e.target.checked)}
            />
          </div>
        </Card>
      ) : null}

      {step === 'apply' && session ? (
        <Card
          title="4. File assisted application"
          footer={
            <Button disabled={busy} onClick={() => void apply()}>
              {busy ? 'Filing…' : 'File application'}
            </Button>
          }
        >
          <div className="sf-form-stack">
            <p className="ux4g-body-m-default">
              Creates a draft owned by the citizen via server-mediated filing. Your officer session
              is never swapped to the citizen.
            </p>
            <TextInput
              id="catalogue"
              label="Offering catalogue id"
              value={catalogueId}
              onChange={(e) => setCatalogueId(e.target.value)}
            />
          </div>
        </Card>
      ) : null}

      {step === 'done' ? (
        <Card title="Assisted apply linked">
          <p className="ux4g-body-m-default">
            Application <code>{applicationId ?? session?.application_id}</code> is owned by the
            citizen. Operator proof remains on the assisted session.
          </p>
          {applicationId ? (
            <p className="ux4g-body-m-default">
              <Link href={`/applications/${applicationId}`} className="ux4g-text-link-m">
                Open application
              </Link>
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
