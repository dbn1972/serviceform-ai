import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { CertificateDetail } from '../../../components/CertificateDetail';
import { CitizenNav } from '../../../components/CitizenNav';
import { CitizenPageHeader } from '../../../components/CitizenPageHeader';
import { RequireCitizenSession } from '../../../components/RequireCitizenSession';

export const metadata: Metadata = { title: 'Application - ServiceForm AI - Citizen Portal' };

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = id.slice(0, 8).toUpperCase();
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          crumbs={[{ href: '/certificates', label: 'My applications' }, { label: `Ref ${ref}` }]}
          title="Residence Certificate"
          lead={`Application reference ${ref}. Track progress and publish the issued certificate to DigiLocker (SIMULATED).`}
        />
        <CertificateDetail id={id} />
      </RequireCitizenSession>
    </AppShell>
  );
}
