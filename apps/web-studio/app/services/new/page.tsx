import { Alert, AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { StudioNav } from '../../../components/StudioNav';

export default function NewServicePage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Author service metadata</h1>
        <p className="ux4g-body-m-default">
          Configure IND-SOC-002 Residence Certificate from Studio metadata — not custom code.
        </p>
      </section>

      <Alert variant="info" title="IND-SOC-002 sample on tip">
        Residence Certificate template is authored as Studio metadata (public e-District sample). No
        bespoke backend. DigiLocker remains SAMPLE_LAB / SIMULATED. G6 not issued.
      </Alert>

      <Card
        title="Next steps in Studio"
        subtitle="Template path: templates/residence-certificate/"
        footer={
          <div className="sf-actions">
            <TextLink href="/metadata">Open Metadata designer</TextLink>
            <TextLink href="/publication">Open Publication desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Use the Metadata designer for generic document kinds, then Publication for maker/checker.
        </p>
      </Card>
    </AppShell>
  );
}
