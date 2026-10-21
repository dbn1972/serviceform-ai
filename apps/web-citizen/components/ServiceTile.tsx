import { Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import type { ServiceFacts } from './auth/AuthContextPanel';

export const RESIDENCE_SUMMARY =
  'Certifies that you live at your current address. Issued after verification by an officer.';

export function ServiceTile({
  service,
  headingLevel = 2,
}: {
  service: ServiceFacts;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const titleId = `service-${service.catalogueId.toLowerCase()}`;
  return (
    <article className="sf-service-tile" aria-labelledby={titleId}>
      <div className="sf-service-tile-head">
        <span className="sf-service-mark">
          <Icon name="document" size={24} />
        </span>
        <div>
          <p className="sf-service-code">{service.catalogueId}</p>
          <Heading id={titleId} className="ux4g-heading-m-strong">
            {service.serviceName}
          </Heading>
          <p className="ux4g-body-m-default">{RESIDENCE_SUMMARY}</p>
        </div>
      </div>
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
      <div className="sf-tile-actions">
        <Link
          className="ux4g-btn-primary ux4g-btn-m"
          href={`/services/${service.catalogueId}/apply`}
          aria-label={`Apply now for ${service.serviceName}`}
        >
          Apply now
          <Icon name="arrow-right" size={18} />
        </Link>
        <Link
          className="ux4g-btn-outline-neutral ux4g-btn-m"
          href={`/services/${service.catalogueId}`}
          aria-label={`View details of ${service.serviceName}`}
        >
          View details
        </Link>
      </div>
    </article>
  );
}
