import { AppShell } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../../components/OfficerNav';
import { OpsDesk } from '../../components/OpsDesk';

export default function OpsPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Ops dashboard"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Ops dashboard</h1>
        <p className="ux4g-body-m-default">Workload and health aggregates beyond a single queue.</p>
      </section>
      <OpsDesk />
    </AppShell>
  );
}
