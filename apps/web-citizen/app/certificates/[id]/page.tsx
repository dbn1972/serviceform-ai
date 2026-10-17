import { AppShell } from '@serviceform/ui-ux4g';
import { CertificateDetail } from '../../../components/CertificateDetail';
import { CitizenNav } from '../../../components/CitizenNav';

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell surface="citizen_web" title="Citizen Portal">
      <CitizenNav />
      <h1>Certificate / application</h1>
      <CertificateDetail id={id} />
    </AppShell>
  );
}
