import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../components/OfficerNav';

export default function HomePage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Officer Workbench</h1>
        <p className="ux4g-body-m-default">
          Review submitted applications, record decisions, and issue SAMPLE_LAB credentials.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">IND-SOC-002 queue</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
        </div>
      </section>

      <Card
        title="Residence Certificate queue"
        subtitle="Shared SAMPLE_LAB store with Citizen Portal"
        footer={
          <div className="sf-actions">
            <TextLink href="/applications">Open applications</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          DigiLocker publish stays on the citizen side as a SIMULATED mock after issue.
        </p>
      </Card>
    </AppShell>
  );
}
