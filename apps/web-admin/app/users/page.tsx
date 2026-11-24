import { AppShell, Card } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { UsersDesk } from '../../components/UsersDesk';

export default function UsersPage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>Tenant users</h1>
      <Card title="Workforce directory (Keycloak Admin REST or SIMULATED)">
        <UsersDesk />
      </Card>
    </AppShell>
  );
}
