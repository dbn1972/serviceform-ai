import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../components/CitizenNav';
import { PrivacyCentre } from '../../components/PrivacyCentre';

export default function PrivacyPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Privacy centre"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <PrivacyCentre />
    </AppShell>
  );
}
