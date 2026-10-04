import { AppShell, Card } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { BindingDesk } from '../../components/BindingDesk';

export default function BindingsPage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>TenantServiceBinding</h1>
      <Card title="Version pin">
        <BindingDesk />
      </Card>
    </AppShell>
  );
}
