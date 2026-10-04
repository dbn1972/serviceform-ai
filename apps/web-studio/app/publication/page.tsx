import { AppShell, Card } from '@serviceform/ui-ux4g';
import { PublicationDesk } from '../../components/PublicationDesk';
import { StudioNav } from '../../components/StudioNav';

export default function PublicationPage() {
  return (
    <AppShell surface="service_studio" title="Service Design Studio">
      <StudioNav />
      <h1>Publication</h1>
      <Card title="Maker-checker (INT-002)">
        <PublicationDesk />
      </Card>
    </AppShell>
  );
}
