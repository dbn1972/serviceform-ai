import { AppShell, Card } from '@serviceform/ui-ux4g';
import { SessionForm } from '../../components/SessionForm';
import { StudioNav } from '../../components/StudioNav';

export default function SessionPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Studio session</h1>
        <p className="ux4g-body-m-default">
          Tenant id comes from this session cookie, never from a client tenant header.
        </p>
      </section>
      <Card title="SIMULATED workforce session">
        <SessionForm defaultRole="STUDIO_DESIGNER" />
      </Card>
    </AppShell>
  );
}
