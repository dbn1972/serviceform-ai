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
          The checker cannot be the maker. CMP-051 remains the engine.
        </p>
        <ReviewDesk />
      </Card>
    </AppShell>
  );
}
