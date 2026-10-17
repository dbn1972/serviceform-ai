import { AppShell } from '@serviceform/ui-ux4g';
import { ApplicationReview } from '../../../components/ApplicationReview';
import { OfficerNav } from '../../../components/OfficerNav';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell surface="officer_workbench" title="Officer Workbench">
      <OfficerNav />
      <h1>Review application</h1>
      <ApplicationReview id={id} />
    </AppShell>
  );
}
