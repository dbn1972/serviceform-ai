import { AdminShell } from '../../components/AdminShell';
import { DiscoveryDesk } from '../../components/DiscoveryDesk';

export default function DiscoveryPage() {
  return (
    <AdminShell title="Service discovery">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Service discovery</h1>
        <p className="ux4g-body-m-default">
          Browse published SAMPLE_LAB offers without inventing statute.
        </p>
      </section>
      <DiscoveryDesk />
    </AdminShell>
  );
}
