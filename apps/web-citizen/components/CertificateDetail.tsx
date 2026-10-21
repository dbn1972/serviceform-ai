'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import { maskMobile } from '@serviceform/m10-sample-lab/identity-rules';
import { useCallback, useEffect, useState } from 'react';
import { GENDER_LABEL, applicationStatus, evidenceLabel, formatDate } from '../lib/ind-soc-002';
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
  eligibility_pass: boolean;
  fee_paisa: number;
  rejection_reason?: string;
  credential_id?: string;
  digilocker: {
    mode: string;
    doc_type: string;
    status: string;
    provider_transaction_ref?: string;
    simulation_marker: string;
  };
};

type Step = { label: string; detail: string; done: boolean; current: boolean };

const STATUS_ICON = {
  info: 'clock',
  success: 'check-circle',
  error: 'alert',
  neutral: 'document',
} as const;

function timeline(app: App): Step[] {
  const decided = ['APPROVED', 'ISSUED', 'REJECTED'].includes(app.status);
  const issued = app.status === 'ISSUED';
  const published = app.digilocker.status === 'PUBLISHED';
  return [
    { label: 'Submitted', detail: formatDate(app.created_at), done: true, current: false },
    {
      label: app.status === 'REJECTED' ? 'Not approved' : 'Officer decision',
      detail: decided
        ? app.status === 'REJECTED'
          ? 'Decision recorded'
          : 'Approved'
        : 'Under review',
      done: decided,
      current: app.status === 'SUBMITTED',
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
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/lab/applications/${id}`);
    const body = (await res.json()) as { application?: App; error_code?: string };
    if (!res.ok || !body.application) {
      setError(body.error_code ?? 'SF-LAB-404');
      return;
    }
    setApp(body.application);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publishDigiLocker() {
    setError('');
    setInfo('');
    setPublishing(true);
    const res = await fetch(`/api/lab/applications/${id}/digilocker-publish`, { method: 'POST' });
    const body = (await res.json()) as { error_code?: string; note?: string; application?: App };
    setPublishing(false);
    if (!res.ok) {
      setError(body.error_code ?? 'SF-LAB-DIGILOCKER');
      return;
    }
    setInfo(body.note ?? 'SIMULATED DigiLocker publish complete');
    if (body.application) setApp(body.application);
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
  const canPublish = app.status === 'ISSUED' && app.digilocker.status !== 'PUBLISHED';

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
        {app.status === 'REJECTED' ? (
          <FormAlert tone="error" title="Application not approved">
            {app.rejection_reason ?? 'The officer recorded a decision on this application.'}
          </FormAlert>
        ) : null}
        {canPublish ? (
          <FormAlert tone="success" title="Certificate issued (SAMPLE_LAB)">
            Publish it to DigiLocker to keep a digital copy. DigiLocker is SIMULATED in this lab.
          </FormAlert>
        ) : null}
        {info ? (
          <FormAlert tone="success" title="Saved to DigiLocker">
            {info}
          </FormAlert>
        ) : null}
        {error ? (
          <FormAlert tone="error" title="DigiLocker publish failed">
            {error}
          </FormAlert>
        ) : null}
        {canPublish ? (
          <div className="sf-tile-actions">
            <Button size="l" disabled={publishing} onClick={() => void publishDigiLocker()}>
              <Icon name="inbox" size={18} />
              Publish to DigiLocker (SIMULATED)
            </Button>
          </div>
        ) : null}
      </section>

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
            <dd>{app.eligibility_pass ? 'Meets sample policy' : 'Does not meet sample policy'}</dd>
            <dt>Fee</dt>
            <dd>₹{(app.fee_paisa / 100).toFixed(0)}</dd>
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
            <dt>File</dt>
            <dd>
              {app.evidence_file_name
                ? `${app.evidence_file_name}${app.evidence_mime ? ` (${app.evidence_mime})` : ''}`
                : '—'}
            </dd>
            <dt>Doc type</dt>
            <dd>{app.digilocker.doc_type}</dd>
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
