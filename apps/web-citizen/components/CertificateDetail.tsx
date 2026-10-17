'use client';

import { Alert, Button, Card } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';

type App = {
  id: string;
  status: string;
  applicant_name: string;
  residence_duration_months: number;
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

  return (
    <Card title={`Application ${app.id.slice(0, 8)}…`}>
      <Alert variant="info" title={`Status: ${app.status}`}>
        Eligibility {app.eligibility_pass ? 'PASS' : 'FAIL'} · Fee ₹
        {(app.fee_paisa / 100).toFixed(0)} · Residence {app.residence_duration_months} months
      </Alert>
      <p className="ux4g-body-m-default">Applicant (synthetic): {app.applicant_name}</p>
      {app.credential_id ? (
        <Alert variant="success" title="Credential issued (SAMPLE_LAB)">
          {app.credential_id}
        </Alert>
      ) : (
        <Alert variant="warning" title="Awaiting officer decision">
          Open Officer Workbench → Applications to approve (SAMPLE_LAB).
        </Alert>
      )}
      <h2 className="ux4g-heading-s">DigiLocker (SIMULATED mock)</h2>
      <p className="ux4g-body-m-default">
        Mode: {app.digilocker.mode} · Doc type: {app.digilocker.doc_type} · Status:{' '}
        {app.digilocker.status}
      </p>
      {app.digilocker.provider_transaction_ref ? (
        <p className="ux4g-body-m-default">
          Provider ref: {app.digilocker.provider_transaction_ref}
        </p>
      ) : null}
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
      <Button
        disabled={app.status !== 'ISSUED' || app.digilocker.status === 'PUBLISHED'}
        onClick={() => void publishDigiLocker()}
      >
        Publish to DigiLocker (SIMULATED)
      </Button>
    </Card>
  );
}
