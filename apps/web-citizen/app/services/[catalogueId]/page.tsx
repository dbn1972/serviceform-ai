import { AppShell, Icon } from '@serviceform/ui-ux4g';
import { templateByCatalogueId } from '@serviceform/service-templates';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CitizenNav } from '../../../components/CitizenNav';
import { CitizenPageHeader } from '../../../components/CitizenPageHeader';
import { FormAlert } from '../../../components/FormFeedback';
import { RequireCitizenSession } from '../../../components/RequireCitizenSession';
import { formOutline, isOffered, policyText } from '../../../lib/catalogue';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ catalogueId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = templateByCatalogueId((await params).catalogueId);
  return { title: `${t?.name ?? 'Service'} - ServiceForm AI - Citizen Portal` };
}

/** Service overview built from catalogue metadata, for any service in the catalogue. */
export default async function ServiceDetailPage({ params }: Props) {
  const template = templateByCatalogueId((await params).catalogueId);
  if (!template) notFound();
  const offered = isOffered(template);
  const outline = formOutline(template);
  const facts = [
    ['Fee', policyText(template.policy.fee)],
    ['Service time', policyText(template.policy.service_time)],
    ['Eligibility', policyText(template.policy.eligibility)],
    ['Delivered to', `DigiLocker (SIMULATED) · ${template.digilocker_suitability} suitability`],
  ] as const;

  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <CitizenPageHeader
          crumbs={[{ href: '/services', label: 'Services' }, { label: template.name }]}
          title={template.name}
          lead={template.summary}
          meta={
            <>
              <span className="ux4g-tag-tonal-neutral">{template.catalogue_id}</span>
              <span className="ux4g-tag-tonal-neutral">{template.output_type}</span>
              {offered ? null : (
                <span className="ux4g-tag-tonal-warning">Not yet offered here</span>
              )}
            </>
          }
        />

        {offered ? null : (
          <FormAlert tone="warning" title="You cannot apply for this service in this portal yet">
            The department has not published this certificate here. The details below come from the
            national service catalogue; fees, documents and eligibility will be confirmed when it is
            published.
          </FormAlert>
        )}

        <div className="sf-split">
          <div className="sf-section">
            <section className="sf-panel" aria-labelledby="detail-about">
              <h2 id="detail-about" className="ux4g-heading-s-strong">
                About this certificate
              </h2>
              <p>{template.definition}</p>
              <dl className="sf-dl">
                <dt>Issued by</dt>
                <dd>{template.issuing_authority_class}</dd>
                <dt>Validity</dt>
                <dd>{template.lifecycle_class}</dd>
                <dt>Format</dt>
                <dd>{template.credential_form}</dd>
              </dl>
            </section>

            <section className="sf-panel" aria-labelledby="detail-asked">
              <h2 id="detail-asked" className="ux4g-heading-s-strong">
                What you will be asked
              </h2>
              <p>
                {outline.steps.length} steps: {outline.steps.join(' → ')}.
              </p>
              <ul className="sf-checklist">
                {outline.fields.map((f) => (
                  <li key={f.pointer}>
                    <Icon name="check-circle" size={18} />
                    {f.title}
                    {f.required ? null : ' (optional)'}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sf-panel" aria-labelledby="detail-contains">
              <h2 id="detail-contains" className="ux4g-heading-s-strong">
                What the certificate shows
              </h2>
              <ul className="sf-checklist">
                {template.credential_fields.map((f) => (
                  <li key={f.field_id}>
                    <Icon name="document" size={18} />
                    {f.label}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="sf-panel sf-split-aside" aria-labelledby="detail-glance">
            <h2 id="detail-glance" className="ux4g-heading-s-strong">
              At a glance
            </h2>
            <dl className="sf-facts-light">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="sf-auth-actions">
              {offered ? (
                <Link
                  className="ux4g-btn-primary ux4g-btn-l"
                  href={`/services/${template.catalogue_id}/apply`}
                >
                  Start application
                  <Icon name="arrow-right" size={18} />
                </Link>
              ) : (
                <Link className="ux4g-btn-outline-neutral ux4g-btn-l" href="/services">
                  <Icon name="arrow-left" size={18} />
                  Back to services
                </Link>
              )}
            </div>
          </aside>
        </div>
      </RequireCitizenSession>
    </AppShell>
  );
}
