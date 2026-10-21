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
  return (
    <article
      className="sf-app-card"
      aria-labelledby={`app-${app.id}`}
      data-testid="application-card"
    >
      <span className="sf-service-mark">
        <Icon name="document" size={22} />
      </span>
      <div className="sf-app-card-main">
        <Heading id={`app-${app.id}`} className="ux4g-heading-xs-strong">
          Residence Certificate
        </Heading>
        <p className="sf-app-card-meta">
          Ref {ref} · Submitted {formatDate(app.created_at)}
        </p>
        <p className={`sf-status sf-status-${status.tone}`}>
          <Icon name={STATUS_ICON[status.tone]} size={18} />
          {status.label}
        </p>
      </div>
      <div className="sf-app-card-actions">
        <Link
          className="ux4g-btn-outline-neutral ux4g-btn-s"
          href={`/certificates/${app.id}`}
          aria-label={`View application ${ref}`}
        >
          View
        </Link>
      </div>
    </article>
  );
}
