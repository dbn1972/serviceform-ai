import { Card } from '@serviceform/ui-ux4g';
import { AdminShell } from '../../components/AdminShell';
import { BindingDesk } from '../../components/BindingDesk';
import { JurisdictionScopeDesk } from '../../components/JurisdictionScopeDesk';

export default function BindingsPage() {
  return (
    <AdminShell title="Administration">
      <h1 className="ux4g-heading-2xl-strong">TenantServiceBinding</h1>
      <Card title="Version pin">
        <BindingDesk />
      </Card>
      <Card title="Jurisdiction scope (states / districts / municipalities)">
        <JurisdictionScopeDesk />
      </Card>
    </AdminShell>
  );
}
