import { AppShell } from '@serviceform/ui-ux4g';
import { StudioNav } from '../components/StudioNav';

export default function HomePage() {
  return (
    <AppShell surface="service_studio" title="Service Design Studio">
      <StudioNav />
      <h1>Service Design Studio</h1>
      <p className="ux4g-body-m-default">
        Author generic service metadata, validate it, then submit a maker-checker publication
        request. Published versions are immutable; applications pin TenantServiceBinding versions.
      </p>
    </AppShell>
  );
}
