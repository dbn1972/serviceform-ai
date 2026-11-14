'use client';

import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';
import { OfficerNav } from '../../components/OfficerNav';
import { RequireOfficerSession } from '../../components/RequireOfficerSession';

type App = {
  id: string;
  status: string;
  platform_state: string;
  applicant_name?: string;
  catalogue_id?: string;
  purpose_of_certificate?: string;
  residence_duration_months?: number;
};

function QueueList() {
  const [apps, setApps] = useState<App[] | null>(null);

  useEffect(() => {
    void fetch('/api/portal/applications')
      .then((r) => r.json())
      .then((body: { applications?: App[] }) => setApps(body.applications ?? []));
  }, []);

  if (apps === null) return <p className="ux4g-body-m-default">Loading queue…</p>;
  if (apps.length === 0) {
    return (
      <Card title="Queue empty">
        <p className="ux4g-body-m-default">No submitted applications for this office yet.</p>
      </Card>
    );
  }
  return (
    <div className="sf-queue">
      {apps.map((a) => (
        <Card key={a.id} title={a.applicant_name ?? 'Applicant'}>
          <div className="sf-queue-item">
            <div className="sf-queue-item-main">
              <div className="sf-meta-row">
                <span className={statusTag(a.status)}>{a.status}</span>
                <span className="ux4g-tag-tonal-neutral">{a.platform_state}</span>
              </div>
              <p className="ux4g-body-s-default">
                {a.catalogue_id ? `${a.catalogue_id} · ` : ''}
                {typeof a.residence_duration_months === 'number'
                  ? `${a.residence_duration_months} months residence · `
                  : a.purpose_of_certificate
                    ? `${a.purpose_of_certificate.slice(0, 40)} · `
                    : ''}
                Ref {a.id.slice(0, 8)}…
              </p>
            </div>
            <TextLink href={`/applications/${a.id}`}>Review</TextLink>
          </div>
        </Card>
      ))}
    </div>
  );
}

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

export default function ApplicationsPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Applications</h1>
        <p className="ux4g-body-m-default">
          Review and decide submitted certificate applications for your office.
        </p>
      </section>

      <Alert variant="info" title="Platform path (SAMPLE_LAB)">
        Cases come from the Application/Case service (CMP-015) for your office&apos;s tenant only.
        Connectors are SIMULATED.
      </Alert>

      <RequireOfficerSession>
        <QueueList />
      </RequireOfficerSession>
    </AppShell>
  );
}
