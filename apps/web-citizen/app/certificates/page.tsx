import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CitizenNav } from '../../components/CitizenNav';
import { CitizenPageHeader } from '../../components/CitizenPageHeader';
import { MyApplications } from '../../components/MyApplications';
import { RequireCitizenSession } from '../../components/RequireCitizenSession';

export const metadata: Metadata = { title: 'My applications - ServiceForm AI - Citizen Portal' };

export default function CertificatesPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          crumbs={[{ href: '/', label: 'Home' }, { label: 'My applications' }]}
          title="My applications"
          lead="Track each application and publish issued certificates to DigiLocker (SIMULATED)."
          actions={
            <Link className="ux4g-btn-outline-neutral ux4g-btn-m" href="/services">
              Start a new application
            </Link>
          }
        />
        <MyApplications />
      </RequireCitizenSession>
    </AppShell>
  );
}
