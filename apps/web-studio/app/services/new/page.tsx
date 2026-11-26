import { Alert, AppShell, Card } from '@serviceform/ui-ux4g';
import Link from 'next/link';
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
        <div className="sf-tag-row">
          <span className="ux4g-tag-outline-warning">Sample lab</span>
        </div>
      </section>

      <Alert variant="info" title="Start from a catalogue template">
        Residence Certificate is the golden SAMPLE_LAB path. DigiLocker remains SIMULATED. No
        bespoke backend for this normal service.
      </Alert>

      <Card
        title="Step 1 — Choose a starting template"
        subtitle="templates/residence-certificate/"
        footer={
          <div className="sf-actions">
            <Link
              className="ux4g-btn-primary ux4g-btn-m"
              href="/templates/ind-soc-002.residence-certificate"
            >
              Start from Residence template
            </Link>
            <Link className="ux4g-btn-outline-primary ux4g-btn-m" href="/templates">
              Browse catalogue
            </Link>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Open the versioned Residence Certificate template, then continue into the designers for
          forms, workflow, rules and related packs.
        </p>
      </Card>

      <Card
        title="Step 2 — Author metadata kinds"
        subtitle="Generic document kinds · UX4G controls"
        footer={
          <div className="sf-actions">
            <Link className="ux4g-btn-outline-primary ux4g-btn-m" href="/metadata">
              Open Metadata designer
            </Link>
            <Link className="ux4g-btn-outline-neutral ux4g-btn-m" href="/forms">
              Forms designer hub
            </Link>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Use the Metadata designer for generic document kinds. Forms and other hubs keep blank,
          draft and template starting points.
        </p>
      </Card>

      <Card
        title="Step 3 — Maker-checker publication"
        subtitle="Published versions are immutable"
        footer={
          <div className="sf-actions">
            <Link className="ux4g-btn-outline-primary ux4g-btn-m" href="/publication">
              Open Publication desk
            </Link>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Submit a publication request. A different officer approves; the maker cannot self-approve.
        </p>
      </Card>
    </AppShell>
  );
}
