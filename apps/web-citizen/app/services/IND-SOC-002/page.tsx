import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../../components/CitizenNav';
import { ResidenceApplyForm } from '../../../components/ResidenceApplyForm';

export default function ResidenceServicePage() {
  return (
    <AppShell surface="citizen_web" title="Citizen Portal">
      <CitizenNav />
      <h1>Residence Certificate (IND-SOC-002)</h1>
      <ResidenceApplyForm />
    </AppShell>
  );
}
