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
          Role-aware SIM login routes each desk role_code to its queue — scrutiny, approving, or
          helpdesk — then HUMAN_TASK decisions and SAMPLE_LAB credential issuance.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">Scrutiny · Approving · Helpdesk</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>

      <Card
        title="Application queue"
        subtitle="CMP-017 desks from Studio workflow role_code · catalogue-generic"
        footer={
          <div className="sf-actions">
            <TextLink href="/applications">Open applications</TextLink>
            <TextLink href="/helpdesk">Helpdesk desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Sign in as a scrutiny, approving, or helpdesk desk officer (role codes only — never named
          people). Post-login routing seeds the matching desk; forwarding hands the case to the next
          HUMAN_TASK; final approval issues the credential through SIMULATED connectors.
        </p>
      </Card>
    </AppShell>
  );
}
