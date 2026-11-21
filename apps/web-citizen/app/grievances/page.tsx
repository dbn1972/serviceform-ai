import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../components/CitizenNav';
import { GrievanceDesk } from '../../components/GrievanceDesk';

export default function GrievancesPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Grievances"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <GrievanceDesk />
    </AppShell>
  );
}
