import { AppShell } from '@serviceform/ui-ux4g';
import { CertificateDetail } from '../../../components/CertificateDetail';
import { CitizenNav } from '../../../components/CitizenNav';
import { RequireCitizenSession } from '../../../components/RequireCitizenSession';

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <section className="sf-page-hero">
          <h1 className="ux4g-heading-2xl-strong">Certificate detail</h1>
          <p className="ux4g-body-m-default">Track status and publish to DigiLocker (SIMULATED).</p>
        </section>
        <CertificateDetail id={id} />
      </RequireCitizenSession>
    </AppShell>
  );
}
