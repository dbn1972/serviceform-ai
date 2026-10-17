import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../components/OfficerNav';

export default function HomePage() {
  return (
    <AppShell surface="officer_workbench" title="Officer Workbench">
      <OfficerNav />
      <h1>Officer Workbench</h1>
      <Card title="SAMPLE_LAB queue">
        <p className="ux4g-body-m-default">
          Review IND-SOC-002 Residence Certificate applications from the shared lab store.
          DigiLocker remains SIMULATED. G6 not issued.
        </p>
        <TextLink href="/applications">Open applications</TextLink>
      </Card>
    </AppShell>
  );
}
