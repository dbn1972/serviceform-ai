import { AppShell } from '@serviceform/ui-ux4g';
import { AdminNav } from '../../components/AdminNav';
import { OverlayForm } from '../../components/OverlayForm';

export default function BrandingPage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>Tenant branding</h1>
      <OverlayForm />
    </AppShell>
  );
}
