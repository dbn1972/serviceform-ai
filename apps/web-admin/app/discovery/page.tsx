import { AppShell } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { DiscoveryDesk } from '../../components/DiscoveryDesk';

export default function DiscoveryPage() {
  return (
    <AppShell surface="tenant_admin" title="Service discovery">
      <AdminNav />
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Service discovery</h1>
        <p className="ux4g-body-m-default">
          M08 CMP-006 thin desk — browse published SAMPLE_LAB offers without inventing statute.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">CMP-006</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>
      <DiscoveryDesk />
    </AppShell>
  );
}
