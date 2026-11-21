import { AppShell } from '@serviceform/ui-ux4g';
import { InspectionDesk } from '../../components/InspectionDesk';
import { OfficerNav } from '../../components/OfficerNav';

/**
 * SAMPLE_LAB inspection / verification desk (SF-57 · CMP-018).
 * Metadata-driven pins; schedule / result / DEFICIENCY_NOTED. CERTIFIED=false · G6=false.
 */
export default function InspectionPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Inspection desk"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <InspectionDesk />
    </AppShell>
  );
}
