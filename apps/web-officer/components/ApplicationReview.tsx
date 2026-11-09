'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';

type App = {
  id: string;
  status: string;
  platform_state: string;
  applicant_name?: string;
  applicant_mobile?: string;
  residence_duration_months?: number;
  purpose_of_certificate?: string;
  evidence_type?: string;
  evidence_file_name?: string;
  residence_address?: {
    house_no_or_name: string;
    locality: string;
    district: string;
    state_code: string;
    pincode: string;
  };
  credential_id?: string;
  rejection_reason?: string;
  digilocker?: { mode: string; status: string; provider_transaction_ref?: string };
  issuance_error?: { error_code: string; step: string };
};

const AWAITING_ISSUE = ['APPROVED', 'SIGNING_PENDING'];

function statusTag(status: string): string {
  switch (status) {
    case 'ISSUED':
      return 'ux4g-tag-tonal-success';
    case 'REJECTED':
      return 'ux4g-tag-tonal-error';
    case 'SUBMITTED':
      return 'ux4g-tag-tonal-info';
    default:
      return 'ux4g-tag-tonal-neutral';
  }
}

export function ApplicationReview({ id }: { id: string }) {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/applications/${id}`);
    const body = (await res.json().catch(() => ({}))) as { application?: App; message?: string };
    if (!res.ok || !body.application) {
      setError(body.message ?? 'Application not found');
      return;
    }
    setApp(body.application);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: 'APPROVE' | 'REJECT' | 'ISSUE') {
    setError('');
    setInfo('');
    const res = await fetch(`/api/portal/applications/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      message?: string;
      application?: App;
    };
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'The decision could not be recorded');
      return;
    }
    const next = body.application;
    if (next) setApp(next);
    if (action === 'REJECT') {
      setInfo('Rejected. Your decision is recorded on the case as a human decision.');
      return;
    }
    const decision =
      action === 'APPROVE'
        ? 'Approved. Your decision is recorded on the case as a human decision. '
        : '';
    setInfo(
      next?.issuance_error
        ? `${decision}Issuance did not complete (${next.issuance_error.step}: ${next.issuance_error.error_code}); you can retry it.`
        : next?.digilocker?.status === 'PUBLISHED'
          ? `${decision}Certificate issued and published to DigiLocker (SIMULATED).`
          : `${decision}Certificate issued; DigiLocker publish is ${next?.digilocker?.status ?? 'pending'}.`,
    );
  }

  if (!app && !error) return <p className="ux4g-body-m-default">Loading…</p>;
  if (error && !app) {
    return (
      <Alert variant="error" title="Not found">
        {error}
      </Alert>
    );
  }
  if (!app) return null;

  return (
    <Card
      title="Review application"
      subtitle="Human decision recorded on the Application/Case service (CMP-015)"
      footer={
        app.status === 'SUBMITTED' ? (
          <div className="sf-actions">
            <Button onClick={() => void act('APPROVE')}>Approve</Button>
            <Button variant="outline-danger" onClick={() => void act('REJECT')}>
              Reject
            </Button>
          </div>
        ) : AWAITING_ISSUE.includes(app.platform_state) ? (
          <div className="sf-actions">
            <Button variant="outline-primary" onClick={() => void act('ISSUE')}>
              Retry issuance
            </Button>
          </div>
        ) : null
      }
    >
      <Alert variant="warning" title="Sample lab — SIMULATED issuance, G6 not issued">
        After you approve, the platform signs and issues the certificate and publishes it to
        DigiLocker using SIMULATED connectors. Eligibility rules are not evaluated here yet; review
        the details yourself.
      </Alert>

      <div className="sf-meta-row">
        <span className={statusTag(app.status)}>{app.status}</span>
        <span className="ux4g-tag-tonal-neutral">{app.platform_state}</span>
        {app.digilocker ? (
          <>
            <span className="ux4g-tag-tonal-neutral">DigiLocker · {app.digilocker.status}</span>
            <span className="ux4g-tag-outline-warning">{app.digilocker.mode}</span>
          </>
        ) : null}
      </div>

      <dl className="sf-dl">
        <dt>Applicant</dt>
        <dd>
          {app.applicant_name}
          {app.applicant_mobile ? ` · ${app.applicant_mobile}` : ''}
        </dd>
        <dt>Address</dt>
        <dd>
          {app.residence_address
            ? `${app.residence_address.house_no_or_name}, ${app.residence_address.locality}, ${app.residence_address.district}, ${app.residence_address.state_code} ${app.residence_address.pincode}`
            : '—'}
        </dd>
        <dt>Residence</dt>
        <dd>{app.residence_duration_months ?? '—'} months</dd>
        <dt>Evidence</dt>
        <dd>
          {app.evidence_type}
          {app.evidence_file_name ? ` · ${app.evidence_file_name}` : ''}
        </dd>
        <dt>Purpose</dt>
        <dd>{app.purpose_of_certificate ?? '—'}</dd>
        {app.credential_id ? (
          <>
            <dt>Credential</dt>
            <dd>{app.credential_id}</dd>
          </>
        ) : null}
        {app.digilocker?.provider_transaction_ref ? (
          <>
            <dt>DigiLocker ref</dt>
            <dd>{app.digilocker.provider_transaction_ref}</dd>
          </>
        ) : null}
      </dl>

      {app.rejection_reason ? (
        <Alert variant="error" title="Rejection">
          {app.rejection_reason}
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" title="Decision recorded">
          {info}
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
