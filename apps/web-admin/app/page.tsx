import { AppShell } from '@serviceform/ui-ux4g';
import { AdminNav } from '../components/AdminNav';

export default function HomePage() {
  return (
    <AppShell surface="tenant_admin" title="Administration">
      <AdminNav />
      <h1>Administration</h1>
      <p className="ux4g-body-m-default">
        Pin TenantServiceBinding versions after checker approval. Tenant branding is a UX4G token
        overlay only. Users manages tenant workforce accounts via Keycloak Admin REST when
        configured, otherwise a labelled SIMULATED adapter (M02 identity admin — not a second auth
        product). M08 analytics and discovery desks surface search/ops golden-path capability
        without inventing statute (CERTIFIED=false · G6=false · ADR-0007 not claimed accepted).
      </p>
    </AppShell>
  );
}
