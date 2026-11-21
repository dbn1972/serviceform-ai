import { AppShell } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../../components/OfficerNav';
import { SchedulingDesk } from '../../components/SchedulingDesk';

/**
 * SAMPLE_LAB appointment / scheduling desk (SF-62 · CMP-056 · Constitution #37).
 * Metadata-driven calendars beside CMP-018 inspection. CERTIFIED=false · G6=false.
 */
export default function SchedulingPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Scheduling desk"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <SchedulingDesk />
    </AppShell>
  );
}
