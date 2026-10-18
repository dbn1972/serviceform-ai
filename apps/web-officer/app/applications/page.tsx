'use client';

import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';
import { OfficerNav } from '../../components/OfficerNav';

type App = {
  id: string;
  status: string;
  applicant_name: string;
  residence_duration_months: number;
  eligibility_pass: boolean;
};

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
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    void fetch('/api/lab/applications')
      .then((r) => r.json())
      .then((body: { applications?: App[] }) => setApps(body.applications ?? []));
  }, []);

  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Applications</h1>
        <p className="ux4g-body-m-default">Review and decide IND-SOC-002 Residence Certificate cases.</p>
      </section>

      <Alert variant="info" title="Shared SAMPLE_LAB store">
        Same file store as Citizen Portal (<code>/tmp/sf-m10-ind-soc-002-lab.json</code>).
      </Alert>

      {apps.length === 0 ? (
        <Card title="Queue empty">
          <p className="ux4g-body-m-default">No applications in the lab store yet.</p>
        </Card>
      ) : (
        <div className="sf-queue">
          {apps.map((a) => (
            <Card key={a.id} title={a.applicant_name}>
              <div className="sf-queue-item">
                <div className="sf-queue-item-main">
                  <div className="sf-meta-row">
                    <span className={statusTag(a.status)}>{a.status}</span>
                    <span
                      className={
                        a.eligibility_pass ? 'ux4g-tag-tonal-success' : 'ux4g-tag-tonal-error'
                      }
                    >
                      Eligibility {a.eligibility_pass ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <p className="ux4g-body-s-default">
                    {a.residence_duration_months} months residence · Ref {a.id.slice(0, 8)}…
                  </p>
                </div>
                <TextLink href={`/applications/${a.id}`}>Review</TextLink>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
