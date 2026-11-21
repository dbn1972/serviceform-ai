import { AppShell } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { AnalyticsDesk } from '../../components/AnalyticsDesk';

export default function AnalyticsPage() {
  return (
    <AppShell surface="tenant_admin" title="Analytics & MIS">
      <AdminNav />
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Analytics &amp; MIS</h1>
        <p className="ux4g-body-m-default">
          M08 CMP-045 thin desk on the SAMPLE_LAB admin golden path.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">CMP-045</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>
      <AnalyticsDesk />
    </AppShell>
  );
}
