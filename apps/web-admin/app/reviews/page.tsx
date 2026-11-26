import { Card } from '@serviceform/ui-ux4g';
import { AdminShell } from '../../components/AdminShell';
import { ReviewDesk } from '../../components/ReviewDesk';

export default function ReviewsPage() {
  return (
    <AdminShell title="Administration">
      <h1 className="ux4g-heading-2xl-strong">Checker reviews</h1>
      <Card title="Maker-checker queue">
        <p className="ux4g-body-m-default">
          Maker ≠ checker is mandatory (CMP-051 · Constitution #9). The same principal cannot
          approve their own publication request — buttons stay disabled and the platform refuses
          same-principal approval.
        </p>
        <ReviewDesk />
      </Card>
    </AdminShell>
  );
}
