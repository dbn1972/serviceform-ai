'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';

type App = {
  id: string;
  status: string;
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
  credential_id?: string;
  digilocker: {
    mode: string;
    doc_type: string;
    status: string;
    provider_transaction_ref?: string;
    simulation_marker: string;
  };
};

function statusTag(status: string): string {
  switch (status) {
    case 'ISSUED':
    case 'PUBLISHED':
      return 'ux4g-tag-tonal-success';
    case 'REJECTED':
      return 'ux4g-tag-tonal-error';
    case 'SUBMITTED':
      return 'ux4g-tag-tonal-info';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
}

export function CertificateDetail({ id }: { id: string }) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

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
    const res = await fetch(`/api/lab/applications/${id}/digilocker-publish`, { method: 'POST' });
    const body = (await res.json()) as {
      error_code?: string;
      note?: string;
      application?: App;
    };
    if (!res.ok) {
      setError(body.error_code ?? 'SF-LAB-DIGILOCKER');
      return;
    }
    setInfo(body.note ?? 'SIMULATED DigiLocker publish complete');
    if (body.application) setApp(body.application);
  }

  if (!app && !error) return <p className="ux4g-body-m-default">Loading…</p>;
  if (error && !app) {
    return (
      <Alert variant="error" title="Application not found">
        {error}
      </Alert>
    );
  }
  if (!app) return null;

  const addr = app.residence_address;

  return (
    <Card
      title="Certificate / application"
      subtitle={`Reference ${app.id.slice(0, 8)}…`}
      footer={
        <div className="sf-actions">
          <Button
            disabled={app.status !== 'ISSUED' || app.digilocker.status === 'PUBLISHED'}
            onClick={() => void publishDigiLocker()}
          >
            Publish to DigiLocker (SIMULATED)
          </Button>
        </div>
      }
    >
      <div className="sf-meta-row">
        <span className={statusTag(app.status)}>{app.status}</span>
        <span className={statusTag(app.digilocker.status)}>
          DigiLocker · {app.digilocker.status}
        </span>
        <span className="ux4g-tag-outline-warning">{app.digilocker.mode}</span>
      </div>

      <div className="sf-preview-grid">
        <section className="sf-preview-block">
          <h3 className="ux4g-heading-s-strong">Applicant</h3>
          <dl className="sf-dl">
            <dt>Name</dt>
            <dd>{app.applicant_name}</dd>
            <dt>DOB</dt>
            <dd>{app.applicant_dob ?? '—'}</dd>
            <dt>Gender</dt>
            <dd>{app.applicant_gender ?? '—'}</dd>
            <dt>Mobile</dt>
            <dd>{app.applicant_mobile ?? '—'}</dd>
            <dt>Aadhaar (last 4)</dt>
            <dd>
              {app.applicant_aadhaar_last4 ? `•••• ${app.applicant_aadhaar_last4}` : '—'}
            </dd>
          </dl>
        </section>
        <section className="sf-preview-block">
          <h3 className="ux4g-heading-s-strong">Residence &amp; policy</h3>
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
            <dd>{app.eligibility_pass ? 'PASS' : 'FAIL'}</dd>
            <dt>Fee</dt>
            <dd>₹{(app.fee_paisa / 100).toFixed(0)}</dd>
            <dt>Purpose</dt>
            <dd>{app.purpose_of_certificate ?? '—'}</dd>
          </dl>
        </section>
        <section className="sf-preview-block sf-span-2">
          <h3 className="ux4g-heading-s-strong">Evidence &amp; credential</h3>
          <dl className="sf-dl">
            <dt>Evidence</dt>
            <dd>{app.evidence_type ?? '—'}</dd>
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

      {!app.credential_id ? (
        <Alert variant="warning" title="Awaiting officer decision">
          Open Officer Workbench → Applications to approve (SAMPLE_LAB).
        </Alert>
      ) : (
        <Alert variant="success" title="Credential issued (SAMPLE_LAB)">
          Ready for DigiLocker SIMULATED publish when status is ISSUED.
        </Alert>
      )}

      {info ? (
        <Alert variant="success" title="DigiLocker mock">
          {info}
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="DigiLocker mock failed">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
