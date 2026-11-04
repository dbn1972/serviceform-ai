import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../components/CitizenNav';
import { HomeContent } from '../components/HomeContent';
import { residenceServiceFacts } from '../lib/service-facts';

export default function HomePage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <HomeContent service={residenceServiceFacts()} />
    </AppShell>
  );
}
