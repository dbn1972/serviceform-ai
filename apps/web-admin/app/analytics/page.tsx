import { AdminShell } from '../../components/AdminShell';
import { AnalyticsDesk } from '../../components/AnalyticsDesk';

export default function AnalyticsPage() {
  return (
    <AdminShell title="Analytics & MIS">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Analytics &amp; MIS</h1>
        <p className="ux4g-body-m-default">
          Aggregate metric definitions on the SAMPLE_LAB admin golden path.
        </p>
      </section>
      <AnalyticsDesk />
    </AdminShell>
  );
}
