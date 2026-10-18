import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../components/CitizenNav';

export default function HomePage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Citizen Portal</h1>
        <p className="ux4g-body-m-default">
          Apply for services, track applications, and publish issued credentials to DigiLocker
          (SIMULATED in this lab).
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">IND-SOC-002</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
        </div>
      </section>

      <Card
        title="Residence Certificate"
        subtitle="Public e-District sample · fee ₹0 · DigiLocker SIMULATED"
        footer={
          <div className="sf-actions">
            <TextLink href="/services/IND-SOC-002">Start application</TextLink>
            <TextLink href="/certificates">View my certificates</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Eligibility ≥12 months continuous residence. SLA 10 working days. No real PII — synthetic
          applicants only.
        </p>
      </Card>
    </AppShell>
  );
}
