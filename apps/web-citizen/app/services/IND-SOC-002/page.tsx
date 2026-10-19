'use client';

import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../../components/CitizenNav';
import { RequireCitizenSession } from '../../../components/RequireCitizenSession';

export default function ResidenceOverviewPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <section className="sf-page-hero">
          <h1 className="ux4g-heading-2xl-strong">Residence Certificate</h1>
          <p className="ux4g-body-m-default">
            Service code IND-SOC-002 · authored as Studio metadata · SAMPLE_LAB path only.
          </p>
        </section>

        <Alert variant="info" title="Before you apply">
          Keep evidence ready (electricity bill, RoR, EPIC/Aadhaar, ration card, or lease). Fee is
          ₹0. DigiLocker publish is available only after officer issue — and remains SIMULATED.
        </Alert>

        <Card
          title="Service summary"
          subtitle="Public e-District sample policy facts"
          footer={
            <div className="sf-actions">
              <TextLink href="/services/IND-SOC-002/apply">Continue to application form</TextLink>
            </div>
          }
        >
          <dl className="sf-dl">
            <dt>Eligibility</dt>
            <dd>≥12 months continuous residence</dd>
            <dt>Fee</dt>
            <dd>₹0</dd>
            <dt>SLA</dt>
            <dd>10 working days</dd>
            <dt>Credential</dt>
            <dd>SAMPLE_LAB issue → DigiLocker SIMULATED publish</dd>
          </dl>
        </Card>
      </RequireCitizenSession>
    </AppShell>
  );
}
