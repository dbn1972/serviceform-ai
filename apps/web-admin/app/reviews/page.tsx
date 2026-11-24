import { AppShell, Card } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { ReviewDesk } from '../../components/ReviewDesk';

export default function ReviewsPage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>Checker reviews</h1>
      <Card title="Maker-checker queue">
        <p className="ux4g-body-m-default">
          Maker ≠ checker is mandatory (CMP-051 · Constitution #9). The same principal cannot
          approve their own publication request — buttons stay disabled and the platform refuses
          same-principal approval. CERTIFIED=false · G6=false.
        </p>
        <ReviewDesk />
      </Card>
    </AppShell>
  );
}
