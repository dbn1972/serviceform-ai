import { AppShell } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { FormsKpiDesk } from '../../components/FormsKpiDesk';

export default function FormsKpiPage() {
  return (
    <AppShell surface="tenant_admin" title="Forms product KPIs">
      <AdminNav />
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Forms product KPIs</h1>
        <p className="ux4g-body-m-default">
          Read-only durable measure desk for SAMPLE_LAB (P8-1 / D7). DigiLocker out of scope.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">forms-product-metrics</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>
      <FormsKpiDesk />
    </AppShell>
  );
}
