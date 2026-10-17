'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';

type App = {
  id: string;
  status: string;
  applicant_name: string;
  residence_duration_months: number;
  eligibility_pass: boolean;
  purpose_of_certificate: string;
  evidence_type: string;
  credential_id?: string;
  rejection_reason?: string;
};

export function ApplicationReview({ id }: { id: string }) {
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

  async function act(action: 'APPROVE' | 'REJECT') {
    setError('');
    setInfo('');
    const res = await fetch(`/api/lab/applications/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action,
        rejection_reason: action === 'REJECT' ? 'SAMPLE_LAB officer rejection' : undefined,
      }),
    });
    const body = (await res.json()) as {
      error_code?: string;
      message?: string;
      application?: App;
    };
    if (!res.ok) {
      setError(body.message ?? body.error_code ?? 'SF-LAB-ACTION');
      return;
    }
    setInfo(action === 'APPROVE' ? 'Approved and issued (SAMPLE_LAB)' : 'Rejected (SAMPLE_LAB)');
    if (body.application) setApp(body.application);
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
    <Card title="Application review (SAMPLE_LAB)">
      <Alert variant="warning" title="Sample lab — G6 not issued">
        Approve issues a SAMPLE_LAB credential. DigiLocker publish is citizen-side SIMULATED mock.
      </Alert>
      <p className="ux4g-body-m-default">Applicant: {app.applicant_name}</p>
      <p className="ux4g-body-m-default">
        Status: {app.status} · Residence months: {app.residence_duration_months} · Eligibility:{' '}
        {app.eligibility_pass ? 'PASS' : 'FAIL'}
      </p>
      <p className="ux4g-body-m-default">Evidence: {app.evidence_type}</p>
      <p className="ux4g-body-m-default">Purpose: {app.purpose_of_certificate}</p>
      {app.credential_id ? (
        <Alert variant="success" title="Credential">
          {app.credential_id}
        </Alert>
      ) : null}
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
      {app.status === 'SUBMITTED' ? (
        <>
          <Button onClick={() => void act('APPROVE')}>Approve &amp; issue</Button>
          <Button variant="outline-danger" onClick={() => void act('REJECT')}>
            Reject
          </Button>
        </>
      ) : null}
    </Card>
  );
}
