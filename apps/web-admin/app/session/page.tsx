import { Card } from '@serviceform/ui-ux4g';
import { AdminShell } from '../../components/AdminShell';
import { SessionForm } from '../../components/SessionForm';

export default function SessionPage() {
  return (
    <AdminShell title="Administration">
      <h1 className="ux4g-heading-2xl-strong">Admin session</h1>
      <Card title="SIMULATED workforce session">
        <SessionForm defaultRole="TENANT_ADMIN" />
      </Card>
    </AdminShell>
  );
}
