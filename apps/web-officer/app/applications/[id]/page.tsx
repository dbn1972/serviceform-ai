import { AppShell } from '@serviceform/ui-ux4g';
import { ApplicationReview } from '../../../components/ApplicationReview';
import { OfficerNav } from '../../../components/OfficerNav';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Application review</h1>
        <p className="ux4g-body-m-default">Record an approve or reject decision for this case.</p>
      </section>
      <ApplicationReview id={id} />
    </AppShell>
  );
}
