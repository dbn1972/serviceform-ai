import { AppShell } from '@serviceform/ui-ux4g';
import { HelpdeskDesk } from '../../components/HelpdeskDesk';
import { OfficerNav } from '../../components/OfficerNav';

/**
 * SAMPLE_LAB helpdesk desk (SF-50 role-aware login routing + SF-52 CMP-027 tickets).
 * Helpdesk-only SIM roles land here; case officers can open the same queue from Home.
 */
export default function HelpdeskPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Helpdesk"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <HelpdeskDesk />
    </AppShell>
  );
}
