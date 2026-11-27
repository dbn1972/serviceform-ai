import { AdminShell } from '../../components/AdminShell';
import { FormsKpiDesk } from '../../components/FormsKpiDesk';

export default function FormsKpiPage() {
  return (
    <AdminShell title="Forms product KPIs">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Forms product KPIs</h1>
        <p className="ux4g-body-m-default">
          Read-only durable measure desk for SAMPLE_LAB. DigiLocker out of scope.
        </p>
      </section>
      <FormsKpiDesk />
    </AdminShell>
  );
}
