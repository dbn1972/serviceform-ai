import { AppShell } from '@serviceform/ui-ux4g';
import { notFound } from 'next/navigation';
import { policyText } from '../lib/catalogue';
import { offeredForm } from '../lib/portal/forms';
import { CitizenNav } from './CitizenNav';
import { CitizenPageHeader } from './CitizenPageHeader';
import { MetadataApplyForm } from './MetadataApplyForm';
import { RequireCitizenSession } from './RequireCitizenSession';

/** Apply page for any service this portal offers; the form itself comes from metadata. */
export function ApplyPage({ catalogueId }: { catalogueId: string }) {
  const offered = offeredForm(catalogueId);
  if (!offered) notFound();
  const { template } = offered;
  const { fee, service_time, eligibility } = template.policy;
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          compact
          crumbs={[
            { href: '/services', label: 'Services' },
            { href: `/services/${template.catalogue_id}`, label: template.name },
            { label: 'Apply' },
          ]}
          title={`Apply — ${template.name}`}
          meta={
            <>
              <span className="ux4g-tag-tonal-neutral sf-hero-fact">Fee {policyText(fee)}</span>
              <span className="ux4g-tag-tonal-neutral sf-hero-fact">
                Service time {policyText(service_time)}
              </span>
              <span className="ux4g-tag-tonal-neutral sf-hero-fact">
                Eligibility {policyText(eligibility)}
              </span>
              <span className="ux4g-tag-tonal-neutral">SAMPLE_LAB · DigiLocker SIMULATED</span>
            </>
          }
        />
        <MetadataApplyForm catalogueId={template.catalogue_id} />
      </RequireCitizenSession>
    </AppShell>
  );
}
