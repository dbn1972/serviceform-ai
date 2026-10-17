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

export default function ApplicationsPage() {
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    void fetch('/api/lab/applications')
      .then((r) => r.json())
      .then((body: { applications?: App[] }) => setApps(body.applications ?? []));
  }, []);

  return (
    <AppShell surface="officer_workbench" title="Officer Workbench">
      <OfficerNav />
      <h1>Applications</h1>
      <Alert variant="info" title="Shared SAMPLE_LAB store">
        Same file store as Citizen Portal (<code>/tmp/sf-m10-ind-soc-002-lab.json</code>).
      </Alert>
      {apps.length === 0 ? (
        <p className="ux4g-body-m-default">No applications in the lab store.</p>
      ) : (
        apps.map((a) => (
          <Card key={a.id} title={a.applicant_name}>
            <p className="ux4g-body-m-default">
              {a.status} · {a.residence_duration_months} months · Eligibility{' '}
              {a.eligibility_pass ? 'PASS' : 'FAIL'}
            </p>
            <TextLink href={`/applications/${a.id}`}>Review</TextLink>
          </Card>
        ))
      )}
    </AppShell>
  );
}
