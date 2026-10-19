import { AppShell, Card } from '@serviceform/ui-ux4g';
import { PublicationDesk } from '../../components/PublicationDesk';
import { StudioNav } from '../../components/StudioNav';

export default function PublicationPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Publication</h1>
        <p className="ux4g-body-m-default">Maker-checker publication desk (INT-002).</p>
      </section>
      <Card title="Maker-checker">
        <PublicationDesk />
      </Card>
    </AppShell>
  );
}
