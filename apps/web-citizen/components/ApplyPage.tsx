import { AppShell } from '@serviceform/ui-ux4g';
import { stepLabels } from '@serviceform/service-templates';
import { notFound } from 'next/navigation';
import { offeredForm } from '../lib/portal/forms';
import { CitizenNav } from './CitizenNav';
import { CitizenPageHeader } from './CitizenPageHeader';
import { MetadataApplyForm } from './MetadataApplyForm';
import { RequireCitizenSession } from './RequireCitizenSession';

/** Apply page for any service this portal offers; the form itself comes from metadata. */
export function ApplyPage({ catalogueId }: { catalogueId: string }) {
  const offered = offeredForm(catalogueId);
  if (!offered) notFound();
  const { template, version } = offered;
  const steps = stepLabels(version).map((s) => s.toLowerCase());
  const lead = `${steps.length} short steps: ${steps.slice(0, -1).join(', ')} and ${steps.at(-1) ?? ''}. Fee ${template.policy.fee} · service time ${template.policy.service_time}.`;
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
            { href: `/services/${template.catalogue_id}`, label: template.name },
            { label: 'Apply' },
          ]}
          title={`Apply — ${template.name}`}
          lead={lead}
        />
        <MetadataApplyForm catalogueId={template.catalogue_id} />
      </RequireCitizenSession>
    </AppShell>
  );
}
