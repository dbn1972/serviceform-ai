import { AppShell, Icon } from '@serviceform/ui-ux4g';
import { PUBLIC_SAMPLE_LAB_POLICY } from '@serviceform/m10-sample-lab';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CitizenNav } from '../../../components/CitizenNav';
import { CitizenPageHeader } from '../../../components/CitizenPageHeader';
import { RequireCitizenSession } from '../../../components/RequireCitizenSession';
import { RESIDENCE_SUMMARY } from '../../../components/ServiceTile';
import { VerifiedAsNote } from '../../../components/VerifiedAsNote';
import { EVIDENCE_OPTIONS } from '../../../lib/ind-soc-002';
import { residenceServiceFacts } from '../../../lib/service-facts';

export const metadata: Metadata = {
  title: 'Residence Certificate - ServiceForm AI - Citizen Portal',
};

export default function ResidenceOverviewPage() {
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
          crumbs={[{ href: '/services', label: 'Services' }, { label: service.serviceName }]}
          title={service.serviceName}
          lead={RESIDENCE_SUMMARY}
          meta={
            <>
              <span className="ux4g-tag-tonal-neutral">{service.catalogueId}</span>
              <span className="ux4g-tag-tonal-success">Fee {service.fee}</span>
              <span className="ux4g-tag-tonal-warning">DigiLocker SIMULATED</span>
            </>
          }
        />

        <div className="sf-split">
          <div className="sf-section">
            <section className="sf-panel" aria-labelledby="overview-eligibility">
              <h2 id="overview-eligibility" className="ux4g-heading-s-strong">
                Who can apply
              </h2>
              <p>
                Residents who have lived at their current address for at least{' '}
                <strong>{PUBLIC_SAMPLE_LAB_POLICY.min_residence_months} months</strong>, per the
                published sample policy.
              </p>
            </section>

            <section className="sf-panel" aria-labelledby="overview-documents">
              <h2 id="overview-documents" className="ux4g-heading-s-strong">
                Documents you can use
              </h2>
              <p>Keep one of these ready. You will attach it in step 3 of the application.</p>
              <ul className="sf-checklist">
                {EVIDENCE_OPTIONS.map((option) => (
                  <li key={option.value}>
                    <Icon name="check" size={18} />
                    {option.label}
                  </li>
                ))}
              </ul>
            </section>

            <section className="sf-panel" aria-labelledby="overview-after">
              <h2 id="overview-after" className="ux4g-heading-s-strong">
                What happens after you apply
              </h2>
              <ol className="sf-steps-light">
                <li>
                  <span>
                    <strong>Officer review</strong>
                    An officer verifies your details and document.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Certificate issued</strong>
                    Usually within {service.serviceTime}.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Saved to DigiLocker</strong>
                    Publish it to DigiLocker (SIMULATED in this lab).
                  </span>
                </li>
              </ol>
            </section>
          </div>

          <aside className="sf-panel sf-split-aside" aria-labelledby="overview-summary">
            <h2 id="overview-summary" className="ux4g-heading-s-strong">
              At a glance
            </h2>
            <dl className="sf-facts-light">
              <div>
                <dt>Fee</dt>
                <dd>{service.fee}</dd>
              </div>
              <div>
                <dt>Service time</dt>
                <dd>{service.serviceTime}</dd>
              </div>
              <div>
                <dt>Eligibility</dt>
                <dd>{service.eligibility}</dd>
              </div>
              <div>
                <dt>Delivered to</dt>
                <dd>{service.delivery}</dd>
              </div>
            </dl>
            <div className="sf-auth-actions">
              <Link className="ux4g-btn-primary ux4g-btn-l" href="/services/IND-SOC-002/apply">
                Start application
                <Icon name="arrow-right" size={18} />
              </Link>
            </div>
            <VerifiedAsNote />
          </aside>
        </div>
      </RequireCitizenSession>
    </AppShell>
  );
}
