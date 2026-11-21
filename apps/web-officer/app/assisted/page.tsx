import { AppShell } from '@serviceform/ui-ux4g';
import { AssistedApplyShell } from '../../components/AssistedApplyShell';
import { OfficerNav } from '../../components/OfficerNav';

/**
 * SAMPLE_LAB assisted-service apply shell (SF-54 / Constitution #36 / CSC channel).
 * Operator applied_by + citizen applied_for + representation + fail-closed consent.
 * CERTIFIED=false · G6=false.
 */
export default function AssistedPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Assisted apply"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <AssistedApplyShell />
    </AppShell>
  );
}
