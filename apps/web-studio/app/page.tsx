import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { listTemplates } from '@serviceform/service-templates';
import { StudioNav } from '../components/StudioNav';

export default function HomePage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Service Design Studio</h1>
        <p className="ux4g-body-m-default">
          Author generic service metadata, validate it, then submit a maker-checker publication
          request. Published versions are immutable.
        </p>
      </section>

      <Card
        title="Certificate template catalogue"
        subtitle={`${listTemplates().length} versioned templates · docs/catalogue registry`}
        footer={
          <div className="sf-actions">
            <TextLink href="/templates">Browse templates</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Residence Certificate is published to the SAMPLE_LAB citizen portal; Income, Domicile and
          Birth are stubs from the national registry awaiting statutory policy input.
        </p>
      </Card>

      <Card
        title="Residence Certificate template"
        subtitle="IND-SOC-002 · public e-District sample"
        footer={
          <div className="sf-actions">
            <TextLink href="/templates/ind-soc-002.residence-certificate">Open template</TextLink>
            <TextLink href="/services/new">Author service metadata</TextLink>
            <TextLink href="/metadata">Metadata designer</TextLink>
            <TextLink href="/publication">Publication desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          No bespoke backend for this normal service. DigiLocker remains SAMPLE_LAB / SIMULATED. G6
          not issued.
        </p>
      </Card>
    </AppShell>
  );
}
