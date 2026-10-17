'use client';

import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';
import { CitizenNav } from '../../components/CitizenNav';

type App = { id: string; status: string; applicant_name: string; digilocker: { status: string } };

export default function CertificatesPage() {
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    void fetch('/api/lab/applications')
      .then((r) => r.json())
      .then((body: { applications?: App[] }) => setApps(body.applications ?? []));
  }, []);

  return (
    <AppShell surface="citizen_web" title="Citizen Portal">
      <CitizenNav />
      <h1>My certificates</h1>
      <Alert variant="info" title="SAMPLE_LAB">
        Shared lab store with Officer Workbench. DigiLocker SIMULATED only.
      </Alert>
      {apps.length === 0 ? (
        <p className="ux4g-body-m-default">No applications yet.</p>
      ) : (
        apps.map((a) => (
          <Card key={a.id} title={a.applicant_name}>
            <p className="ux4g-body-m-default">
              Status: {a.status} · DigiLocker: {a.digilocker.status}
            </p>
            <TextLink href={`/certificates/${a.id}`}>Open</TextLink>
          </Card>
        ))
      )}
    </AppShell>
  );
}
