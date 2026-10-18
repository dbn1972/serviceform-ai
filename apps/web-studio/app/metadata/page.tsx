import { AppShell, Card } from '@serviceform/ui-ux4g';
import { MetadataDesigner } from '../../components/MetadataDesigner';
import { StudioNav } from '../../components/StudioNav';

export default function MetadataPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Metadata designer</h1>
        <p className="ux4g-body-m-default">
          JSON Forms is schema/runtime only. Fields render through UX4G controls.
        </p>
      </section>
      <Card title="Generic metadata kinds">
        <MetadataDesigner />
      </Card>
    </AppShell>
  );
}
