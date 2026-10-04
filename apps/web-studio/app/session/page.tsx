import { AppShell, Card } from '@serviceform/ui-ux4g';
import { SessionForm } from '../../components/SessionForm';
import { StudioNav } from '../../components/StudioNav';

export default function SessionPage() {
  return (
    <AppShell surface="service_studio" title="Service Design Studio">
      <StudioNav />
      <h1>Studio session</h1>
      <Card title="SIMULATED workforce session">
        <p className="ux4g-body-m-default">
          Tenant id comes from this session cookie, never from a client tenant header.
        </p>
        <SessionForm defaultRole="STUDIO_DESIGNER" />
      </Card>
    </AppShell>
  );
}
