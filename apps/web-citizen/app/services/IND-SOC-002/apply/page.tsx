import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { CitizenNav } from '../../../../components/CitizenNav';
import { CitizenPageHeader } from '../../../../components/CitizenPageHeader';
import { RequireCitizenSession } from '../../../../components/RequireCitizenSession';
import { ResidenceApplyForm } from '../../../../components/ResidenceApplyForm';
import { residenceServiceFacts } from '../../../../lib/service-facts';

export const metadata: Metadata = {
  title: 'Apply - Residence Certificate - ServiceForm AI - Citizen Portal',
};

export default function ResidenceApplyPage() {
  const service = residenceServiceFacts();
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          crumbs={[
            { href: '/services', label: 'Services' },
            { href: '/services/IND-SOC-002', label: service.serviceName },
            { label: 'Apply' },
          ]}
          title={`Apply — ${service.serviceName}`}
          lead={`Four short steps: applicant, residence, evidence and review. Fee ${service.fee} · service time ${service.serviceTime}.`}
        />
        <ResidenceApplyForm />
      </RequireCitizenSession>
    </AppShell>
  );
}
