'use client';

import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../components/CitizenNav';
import { RequireCitizenSession } from '../../components/RequireCitizenSession';

export default function ServicesCatalogPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <section className="sf-page-hero">
          <h1 className="ux4g-heading-2xl-strong">Available services</h1>
          <p className="ux4g-body-m-default">
            Metadata-driven catalogue. SAMPLE_LAB currently exposes the golden Residence Certificate
            service.
          </p>
        </section>

        <Card
          title="Residence Certificate"
          subtitle="IND-SOC-002 · fee ₹0 · SLA 10 working days"
          footer={
            <div className="sf-actions">
              <TextLink href="/services/IND-SOC-002">View service details</TextLink>
              <TextLink href="/services/IND-SOC-002/apply">Start application</TextLink>
            </div>
          }
        >
          <div className="sf-meta-row">
            <span className="ux4g-tag-tonal-info">Eligibility ≥12 months</span>
            <span className="ux4g-tag-tonal-success">Fee ₹0</span>
            <span className="ux4g-tag-outline-warning">DigiLocker SIMULATED</span>
          </div>
          <p className="ux4g-body-m-default">
            Apply with synthetic evidence, wait for officer decision, then publish the issued
            credential to DigiLocker (mock).
          </p>
        </Card>
      </RequireCitizenSession>
    </AppShell>
  );
}
