'use client';

import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';
import { CitizenNav } from '../../components/CitizenNav';
import { RequireCitizenSession } from '../../components/RequireCitizenSession';

type App = { id: string; status: string; applicant_name: string; digilocker: { status: string } };

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

export default function CertificatesPage() {
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    void fetch('/api/lab/applications')
      .then((r) => r.json())
      .then((body: { applications?: App[] }) => setApps(body.applications ?? []));
  }, []);

  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">My certificates</h1>
        <p className="ux4g-body-m-default">
          Applications and issued credentials from the shared SAMPLE_LAB store.
        </p>
      </section>

      <Alert variant="info" title="Shared lab store">
        Same data as Officer Workbench. DigiLocker remains SIMULATED.
      </Alert>

      {apps.length === 0 ? (
        <Card title="No applications yet">
          <p className="ux4g-body-m-default">
            <TextLink href="/services/IND-SOC-002/apply">Apply for Residence Certificate</TextLink>
          </p>
        </Card>
      ) : (
        <div className="sf-queue">
          {apps.map((a) => (
            <Card key={a.id} title={a.applicant_name}>
              <div className="sf-queue-item">
                <div className="sf-queue-item-main">
                  <div className="sf-meta-row">
                    <span className={statusTag(a.status)}>{a.status}</span>
                    <span className={statusTag(a.digilocker.status)}>
                      DigiLocker · {a.digilocker.status}
                    </span>
                  </div>
                  <p className="ux4g-body-s-default">Ref {a.id.slice(0, 8)}…</p>
                </div>
                <TextLink href={`/certificates/${a.id}`}>Open</TextLink>
              </div>
            </Card>
          ))}
        </div>
      )}
      </RequireCitizenSession>
    </AppShell>
  );
}
