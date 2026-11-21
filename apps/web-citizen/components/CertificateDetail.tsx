'use client';

import { Icon, Button, Checkbox, TextInput } from '@serviceform/ui-ux4g';
import { itemLabel, reasonLabel } from '@serviceform/m10-sample-lab/deficiency-catalogue';
import { maskMobile } from '@serviceform/m10-sample-lab/identity-rules';
import { useCallback, useEffect, useState } from 'react';
import { GENDER_LABEL, applicationStatus, evidenceLabel, formatDate } from '../lib/ind-soc-002';
import { EvidenceUploadField, type EvidenceUploadValue } from './EvidenceUploadField';
import { FormAlert } from './FormFeedback';

type App = {
  id: string;
  status: string;
  created_at?: string;
  applicant_name: string;
  applicant_dob?: string;
  applicant_gender?: string;
  applicant_mobile?: string;
  applicant_aadhaar_last4?: string;
  residence_address?: {
    house_no_or_name: string;
    locality: string;
    post_office?: string;
    district: string;
    state_code: string;
    pincode: string;
  };
  residence_duration_months: number;
  purpose_of_certificate?: string;
  evidence_type?: string;
  evidence_file_name?: string;
  evidence_mime?: string;
  platform_state?: string;
  rejection_reason?: string;
  credential_id?: string;
  digilocker: {
    mode: string;
    status: string;
    provider_transaction_ref?: string;
  };
};

type DeficiencyNotice = {
  deficiency_id: string;
  status: string;
  reason_code: string;
  notice_code: string;
  instruction_ref: string;
  response_due_at: string | null;
  items: { item_code: string; required: boolean; item_status: string }[];
};

type Step = { label: string; detail: string; done: boolean; current: boolean };

const STATUS_ICON = {
  info: 'clock',
  success: 'check-circle',
  error: 'alert',
  neutral: 'document',
} as const;

function timeline(app: App): Step[] {
  const actionRequired = app.status === 'ACTION_REQUIRED';
  const decided = ['APPROVED', 'ISSUED', 'REJECTED'].includes(app.status);
  const issued = app.status === 'ISSUED';
  const published = app.digilocker.status === 'PUBLISHED';
  return [
    { label: 'Submitted', detail: formatDate(app.created_at), done: true, current: false },
    {
      label: actionRequired
        ? 'Action required'
        : app.status === 'REJECTED'
          ? 'Not approved'
          : 'Officer decision',
      detail: actionRequired
        ? 'More information requested'
        : decided
          ? app.status === 'REJECTED'
            ? 'Decision recorded'
            : 'Approved'
          : 'Under review',
      done: decided,
      current: app.status === 'SUBMITTED' || actionRequired,
    },
    {
      label: 'Certificate issued',
      detail: issued ? 'Credential ready' : 'Pending',
      done: issued,
      current: app.status === 'APPROVED',
    },
    {
      label: 'Saved to DigiLocker',
      detail: published ? 'SIMULATED publish' : 'After issue',
      done: published,
      current: issued && !published,
    },
  ];
}

export function CertificateDetail({ id }: { id: string }) {
  const [app, setApp] = useState<App | null>(null);
  const [openDeficiency, setOpenDeficiency] = useState<DeficiencyNotice | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [narrative, setNarrative] = useState('');
  const [provided, setProvided] = useState<string[]>([]);
  const [upload, setUpload] = useState<EvidenceUploadValue | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Sequential: app first. Parallel deficiencies left an unread 404 body on IDOR
    // paths and blocked Playwright networkidle (SF-47 e2e).
    const appRes = await fetch(`/api/portal/applications/${id}`);
    const body = (await appRes.json().catch(() => ({}))) as { application?: App; message?: string };
    if (!appRes.ok || !body.application) {
      setError(body.message ?? 'We could not find this application.');
      setOpenDeficiency(null);
      return;
    }
    setApp(body.application);
    const defRes = await fetch(`/api/portal/applications/${id}/deficiencies`);
    if (!defRes.ok) {
      setOpenDeficiency(null);
      return;
    }
    const defBody = (await defRes.json().catch(() => ({}))) as {
      open_deficiency?: DeficiencyNotice | null;
    };
    const open = defBody.open_deficiency ?? null;
    setOpenDeficiency(open);
    if (open) {
      setProvided(open.items.filter((i) => i.required).map((i) => i.item_code));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleItem(code: string) {
    setProvided((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function submitResponse() {
    if (!openDeficiency) return;
    setError('');
    setInfo('');
    if (narrative.trim().length < 3) {
      setError('Please describe how you are responding.');
      return;
    }
    if (provided.length < 1) {
      setError('Select at least one requested document you are providing.');
      return;
    }
    if (!upload?.technically_accepted || !upload.document_id) {
      setError('Upload a supporting document and wait until it is technically accepted.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/applications/${id}/deficiencies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deficiency_id: openDeficiency.deficiency_id,
          narrative,
          provided_item_codes: provided,
          document_id: upload.document_id,
        }),
      });
      const body = (await res.json()) as {
        message?: string;
        error_code?: string;
        application?: App;
      };
      if (!res.ok) {
        setError(body.message ?? body.error_code ?? 'We could not submit your response.');
        return;
      }
      if (body.application) setApp(body.application);
      setOpenDeficiency(null);
      setInfo(
        'Your response was submitted. The office will continue reviewing your application. CERTIFIED=false · G6=false.',
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!app && !error) {
    return (
      <div className="sf-gate" role="status">
        <span className="sf-spinner" aria-hidden="true" />
        <p className="ux4g-body-m-default">Loading application…</p>
      </div>
    );
  }
  if (error && !app) {
    return (
      <FormAlert tone="error" title="Application not found">
        {error}
      </FormAlert>
    );
  }
  if (!app) return null;

  const status = applicationStatus(app);
  const addr = app.residence_address;

  return (
    <div className="sf-section">
      <section className="sf-panel" aria-labelledby="status-title">
        <div className="sf-section">
          <h2 id="status-title" className="ux4g-heading-s-strong">
            Application status
          </h2>
          <p className={`sf-status sf-status-${status.tone}`}>
            <Icon name={STATUS_ICON[status.tone]} size={18} />
            {status.label}
          </p>
        </div>
        <ol className="sf-timeline" aria-label="Application progress">
          {timeline(app).map((step) => (
            <li
              key={step.label}
              className={step.done ? 'sf-done' : undefined}
              aria-current={step.current ? 'step' : undefined}
            >
              <strong>
                {step.label}
                {step.done ? <span className="ux4g-sr-only"> (completed)</span> : null}
              </strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>

        {app.status === 'SUBMITTED' ? (
          <FormAlert tone="info" title="Awaiting officer decision">
            An officer will review your details and supporting document. In SAMPLE_LAB, approve it
            from Officer Workbench → Applications.
          </FormAlert>
        ) : null}
        {app.status === 'ACTION_REQUIRED' && openDeficiency ? (
          <FormAlert tone="warning" title="Action needed — more information requested">
            {reasonLabel(openDeficiency.reason_code)}. Please provide the documents listed below and
            submit your response. Upload uses CMP-013 (SIMULATED storage) — technical accept only.
          </FormAlert>
        ) : null}
        {app.status === 'ACTION_REQUIRED' && !openDeficiency ? (
          <FormAlert tone="info" title="Action needed">
            The office asked for more information. Refresh this page if the request details have not
            loaded yet.
          </FormAlert>
        ) : null}
        {app.status === 'REJECTED' ? (
          <FormAlert tone="error" title="Application not approved">
            {app.rejection_reason ?? 'The officer recorded a decision on this application.'}
          </FormAlert>
        ) : null}
        {app.status === 'APPROVED' ? (
          <FormAlert tone="info" title="Approved — certificate being issued">
            The officer approved your application. The certificate is issued and saved to your
            DigiLocker automatically; refresh this page shortly to see it.
          </FormAlert>
        ) : null}
        {app.status === 'ISSUED' && app.digilocker.status === 'PUBLISHED' ? (
          <FormAlert tone="success" title="Saved to DigiLocker (SIMULATED)">
            Your certificate was issued and published through a SIMULATED DigiLocker connector in
            this sample lab. It is not a real DigiLocker document.
          </FormAlert>
        ) : null}
        {app.status === 'ISSUED' &&
        (app.digilocker.status === 'FAILED' || app.digilocker.status === 'RETRY_SCHEDULED') ? (
          <FormAlert tone="warning" title="Certificate issued — DigiLocker not updated yet">
            Your certificate is valid. Saving it to DigiLocker did not complete; the office can
            retry it, and you do not need to apply again.
          </FormAlert>
        ) : null}
        {info ? (
          <FormAlert tone="success" title="Response submitted">
            {info}
          </FormAlert>
        ) : null}
        {error ? (
          <FormAlert tone="error" title="Could not submit">
            {error}
          </FormAlert>
        ) : null}
      </section>

      {app.status === 'ACTION_REQUIRED' && openDeficiency ? (
        <section className="sf-panel" aria-labelledby="deficiency-title">
          <h2 id="deficiency-title" className="ux4g-heading-xs-strong">
            Respond to evidence request
          </h2>
          <p className="ux4g-body-m-default">
            Notice {openDeficiency.notice_code} · {reasonLabel(openDeficiency.reason_code)}
          </p>
          <fieldset className="sf-section">
            <legend className="ux4g-label-m-strong">Documents you are providing</legend>
            <div className="sf-section">
              {openDeficiency.items.map((item) => (
                <Checkbox
                  key={item.item_code}
                  id={`item-${item.item_code}`}
                  label={`${itemLabel(item.item_code)}${item.required ? '' : ' (optional)'}`}
                  checked={provided.includes(item.item_code)}
                  onChange={() => toggleItem(item.item_code)}
                />
              ))}
            </div>
          </fieldset>
          <TextInput
            label="Short note to the office"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            hint="Explain what you are uploading. Do not include Aadhaar numbers or other sensitive data."
          />
          <EvidenceUploadField
            label="Upload replacement evidence"
            applicationId={app.id}
            value={upload}
            onChange={setUpload}
            disabled={busy}
          />
          <div className="sf-actions">
            <Button disabled={busy} onClick={() => void submitResponse()}>
              Submit response
            </Button>
          </div>
        </section>
      ) : null}

      <div className="sf-detail-grid">
        <section className="sf-panel" aria-labelledby="detail-applicant">
          <h2 id="detail-applicant" className="ux4g-heading-xs-strong">
            Applicant
          </h2>
          <dl className="sf-dl">
            <dt>Name</dt>
            <dd>{app.applicant_name}</dd>
            <dt>Date of birth</dt>
            <dd>{app.applicant_dob ?? '—'}</dd>
            <dt>Gender</dt>
            <dd>
              {app.applicant_gender
                ? (GENDER_LABEL[app.applicant_gender] ?? app.applicant_gender)
                : '—'}
            </dd>
            <dt>Mobile</dt>
            <dd>{app.applicant_mobile ? maskMobile(app.applicant_mobile) : '—'}</dd>
            <dt>Aadhaar (last 4)</dt>
            <dd>{app.applicant_aadhaar_last4 ? `•••• ${app.applicant_aadhaar_last4}` : '—'}</dd>
          </dl>
        </section>
        <section className="sf-panel" aria-labelledby="detail-residence">
          <h2 id="detail-residence" className="ux4g-heading-xs-strong">
            Residence &amp; policy
          </h2>
          <dl className="sf-dl">
            <dt>Address</dt>
            <dd>
              {addr
                ? `${addr.house_no_or_name}, ${addr.locality}${
                    addr.post_office ? `, ${addr.post_office}` : ''
                  }, ${addr.district}, ${addr.state_code} ${addr.pincode}`
                : '—'}
            </dd>
            <dt>Duration</dt>
            <dd>{app.residence_duration_months} months</dd>
            <dt>Eligibility</dt>
            <dd>Not evaluated yet (rules engine not connected on this path)</dd>
            <dt>Purpose</dt>
            <dd>{app.purpose_of_certificate ?? '—'}</dd>
          </dl>
        </section>
        <section className="sf-panel sf-span-2" aria-labelledby="detail-evidence">
          <h2 id="detail-evidence" className="ux4g-heading-xs-strong">
            Evidence &amp; credential
          </h2>
          <div className="sf-meta-row">
            <span className="ux4g-tag-tonal-neutral">{app.status}</span>
            <span className="ux4g-tag-tonal-neutral">DigiLocker · {app.digilocker.status}</span>
            <span className="ux4g-tag-outline-warning">{app.digilocker.mode}</span>
          </div>
          <dl className="sf-dl">
            <dt>Evidence</dt>
            <dd>{app.evidence_type ? evidenceLabel(app.evidence_type) : '—'}</dd>
            <dt>File / document</dt>
            <dd>
              {app.evidence_file_name
                ? /^[0-9a-f-]{36}$/i.test(app.evidence_file_name)
                  ? `CMP-013 document ${app.evidence_file_name}${
                      app.evidence_mime ? ` · ${app.evidence_mime}` : ''
                    } (technical accept only)`
                  : `${app.evidence_file_name}${app.evidence_mime ? ` (${app.evidence_mime})` : ''}`
                : '—'}
            </dd>
            {app.credential_id ? (
              <>
                <dt>Credential</dt>
                <dd>{app.credential_id}</dd>
              </>
            ) : null}
            {app.digilocker.provider_transaction_ref ? (
              <>
                <dt>Provider ref</dt>
                <dd>{app.digilocker.provider_transaction_ref}</dd>
              </>
            ) : null}
          </dl>
        </section>
      </div>
    </div>
  );
}
