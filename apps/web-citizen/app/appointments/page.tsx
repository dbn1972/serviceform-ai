import { AppShell } from '@serviceform/ui-ux4g';
import { AppointmentBookingDesk } from '../../components/AppointmentBookingDesk';
import { CitizenNav } from '../../components/CitizenNav';
import { RequireCitizenSession } from '../../components/RequireCitizenSession';

/**
 * SAMPLE_LAB citizen appointment booking shell (CMP-056 deepen · Constitution #37).
 * Self-serve book / reschedule / cancel + wait-binding visibility. CERTIFIED=false · G6=false.
 */
export default function AppointmentsPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Appointments"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <AppointmentBookingDesk />
      </RequireCitizenSession>
    </AppShell>
  );
}
