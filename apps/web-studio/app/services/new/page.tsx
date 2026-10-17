import { Alert, AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { StudioNav } from '../../../components/StudioNav';

export default function NewServicePage() {
  return (
    <AppShell surface="service_studio" title="Service Design Studio">
      <StudioNav />
      <h1>Author service metadata</h1>
      <Alert variant="info" title="IND-SOC-002 sample on tip">
        Residence Certificate template is authored as Studio metadata (Odisha public sample). No
        bespoke backend. DigiLocker remains SAMPLE_LAB / SIMULATED. G6 not issued.
      </Alert>
      <Card title="Next steps in Studio">
        <p className="ux4g-body-m-default">
          Use the Metadata designer for generic document kinds, then Publication for maker/checker.
          Template path: <code>templates/residence-certificate/</code>
        </p>
        <p>
          <TextLink href="/metadata">Open Metadata designer</TextLink>
        </p>
        <p>
          <TextLink href="/publication">Open Publication desk</TextLink>
        </p>
      </Card>
    </AppShell>
  );
}
