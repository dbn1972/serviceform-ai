import { AdminShell } from '../../components/AdminShell';
import { OverlayForm } from '../../components/OverlayForm';

export default function BrandingPage() {
  return (
    <AdminShell title="Administration">
      <h1 className="ux4g-heading-2xl-strong">Tenant branding</h1>
      <OverlayForm />
    </AdminShell>
  );
}
