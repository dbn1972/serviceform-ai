import { Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { applicationStatus, formatDate, type ApplicationSummary } from '../lib/ind-soc-002';

const STATUS_ICON = {
  info: 'clock',
  success: 'check-circle',
  error: 'alert',
  neutral: 'document',
} as const;

export function ApplicationCard({
  app,
  headingLevel = 2,
}: {
  app: ApplicationSummary;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const status = applicationStatus(app);
  const ref = app.id.slice(0, 8).toUpperCase();
  const draft = app.status === 'DRAFT';
  const service = app.service_name ?? 'Application';
  return (
    <article
      className="sf-app-card"
      aria-labelledby={`app-${app.id}`}
      data-testid="application-card"
      data-status={app.status}
    >
      <span className="sf-service-mark">
        <Icon name="document" size={22} />
      </span>
      <div className="sf-app-card-main">
        <Heading id={`app-${app.id}`} className="ux4g-heading-xs-strong">
          {service}
        </Heading>
        <p className="sf-app-card-meta">
          Ref {ref} ·{' '}
          {draft
            ? `Saved ${formatDate(app.updated_at ?? app.created_at)}`
            : `Submitted ${formatDate(app.submitted_at ?? app.created_at)}`}
        </p>
        <p className={`sf-status sf-status-${status.tone}`}>
          <Icon name={STATUS_ICON[status.tone]} size={18} />
          {status.label}
        </p>
      </div>
      <div className="sf-app-card-actions">
        {draft && app.catalogue_id ? (
          <Link
            className="ux4g-btn-primary ux4g-btn-s"
            href={`/services/${app.catalogue_id}/apply?draft=${app.id}`}
            aria-label={`Continue ${service} application ${ref}`}
          >
            Continue application
          </Link>
        ) : (
          <Link
            className="ux4g-btn-outline-neutral ux4g-btn-s"
            href={`/certificates/${app.id}`}
            aria-label={`View application ${ref}`}
          >
            View
          </Link>
        )}
      </div>
    </article>
  );
}
