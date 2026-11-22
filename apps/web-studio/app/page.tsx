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
          Residence Certificate is published to the SAMPLE_LAB citizen portal. Income (IND-SOC-031)
          has a SAMPLE_LAB DUMMY config-reuse dry-run (DRAFT / lab-offer only); SF-33 still gates
          statutory PUBLISH. Other stubs remain browse/preview until owner policy.
        </p>
      </Card>

      <Card
        title="Studio designers"
        subtitle="Forms · Workflow · Rules · Fee · SLA · Evidence · Credential"
        footer={
          <div className="sf-actions">
            <TextLink href="/forms">Forms</TextLink>
            <TextLink href="/workflows">Workflows</TextLink>
            <TextLink href="/rules">Rules</TextLink>
            <TextLink href="/fees">Fees</TextLink>
            <TextLink href="/sla">SLA</TextLink>
            <TextLink href="/evidence">Evidence</TextLink>
            <TextLink href="/credentials">Credentials</TextLink>
            <TextLink href="/publication">Publication desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Metadata-driven authoring with UX4G. SAMPLE_LAB_DUMMY overlays are labeled; nothing here
          invents statute. CERTIFIED=false · G6=false.
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

      <Card
        title="Income Certificate — M11 dry-run"
        subtitle="IND-SOC-031 · SAMPLE_LAB DUMMY · DRAFT · SF-33 gated for PUBLISH"
        footer={
          <div className="sf-actions">
            <TextLink href="/templates/ind-soc-031.income-certificate">Open template</TextLink>
            <TextLink href="/forms/designer?template=ind-soc-031.income-certificate">
              Forms designer
            </TextLink>
            <TextLink href="/fees/designer?template=ind-soc-031-dummy">Fee (DUMMY)</TextLink>
            <TextLink href="/sla/designer?template=ind-soc-031-sla">SLA (DUMMY)</TextLink>
            <TextLink href="/evidence/designer?template=ind-soc-031-evidence">Evidence</TextLink>
            <TextLink href="/credentials/designer?template=ind-soc-031-credential">
              Credential
            </TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Second-service config-reuse path. No bespoke Income backend. Lab-offer of DRAFT under
          SAMPLE_LAB only — not a statutory PUBLISHED offering. CERTIFIED=false · G6=false.
        </p>
      </Card>
    </AppShell>
  );
}
