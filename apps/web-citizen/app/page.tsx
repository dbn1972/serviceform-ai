import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../components/CitizenNav';

export default function HomePage() {
  return (
    <AppShell surface="citizen_web" title="Citizen Portal">
      <CitizenNav />
      <h1>Citizen Portal</h1>
      <Card title="Golden sample services">
        <p className="ux4g-body-m-default">
          IND-SOC-002 Residence Certificate — public e-District sample (SAMPLE_LAB). DigiLocker is
          SIMULATED mock. G6 not issued.
        </p>
        <p>
          <TextLink href="/services/IND-SOC-002">Apply for Residence Certificate</TextLink>
        </p>
        <p>
          <TextLink href="/certificates">View my certificates</TextLink>
        </p>
      </Card>
    </AppShell>
  );
}
