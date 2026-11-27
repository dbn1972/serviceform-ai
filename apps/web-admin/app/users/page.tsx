import { Card } from '@serviceform/ui-ux4g';
import { AdminShell } from '../../components/AdminShell';
import { UsersDesk } from '../../components/UsersDesk';

export default function UsersPage() {
  return (
    <AdminShell title="Administration">
      <h1 className="ux4g-heading-2xl-strong">Tenant users</h1>
      <Card title="Workforce directory (Keycloak Admin REST or SIMULATED)">
        <UsersDesk />
      </Card>
    </AdminShell>
  );
}
