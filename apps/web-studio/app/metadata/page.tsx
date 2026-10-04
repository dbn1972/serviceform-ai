import { AppShell, Card } from '@serviceform/ui-ux4g';
import { MetadataDesigner } from '../../components/MetadataDesigner';
import { StudioNav } from '../../components/StudioNav';

export default function MetadataPage() {
  return (
    <AppShell surface="service_studio" title="Service Design Studio">
      <StudioNav />
      <h1>Metadata designer</h1>
      <Card title="Generic metadata kinds">
        <p className="ux4g-body-m-default">
          JSON Forms is schema/runtime only. Fields render through UX4G controls.
        </p>
        <MetadataDesigner />
      </Card>
    </AppShell>
  );
}
