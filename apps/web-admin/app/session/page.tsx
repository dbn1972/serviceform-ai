import { AppShell, Card } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { SessionForm } from '../../components/SessionForm';

export default function SessionPage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>Admin session</h1>
      <Card title="SIMULATED workforce session">
        <SessionForm defaultRole="TENANT_ADMIN" />
      </Card>
    </AppShell>
  );
}
