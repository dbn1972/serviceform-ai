import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { CitizenNav } from '../../components/CitizenNav';
import { CitizenPageHeader } from '../../components/CitizenPageHeader';
import { RequireCitizenSession } from '../../components/RequireCitizenSession';
import { ServiceTile } from '../../components/ServiceTile';
import { residenceServiceFacts } from '../../lib/service-facts';

export const metadata: Metadata = { title: 'Services - ServiceForm AI - Citizen Portal' };

export default function ServicesCatalogPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          crumbs={[{ href: '/', label: 'Home' }, { label: 'Services' }]}
          title="Available services"
          lead="Check eligibility, documents and fees before you apply. Services are published from Studio metadata."
        />
        <ServiceTile service={residenceServiceFacts()} />
      </RequireCitizenSession>
    </AppShell>
  );
}
