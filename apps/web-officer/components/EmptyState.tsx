import { Button, Icon, type IconName } from '@serviceform/ui-ux4g';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  children: ReactNode;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  testId?: string;
};

/** Shared officer empty surface using the UX4G `sf-empty` pattern. */
export function EmptyState({
  title,
  children,
  icon = 'inbox',
  actionLabel,
  onAction,
  actionBusy,
  testId,
}: EmptyStateProps) {
  const headingId = testId ? `${testId}-title` : 'sf-officer-empty-title';
  return (
    <section className="sf-empty" aria-labelledby={headingId} data-testid={testId}>
      <span className="sf-service-mark" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <h2 id={headingId} className="ux4g-heading-s-strong">
        {title}
      </h2>
      <div className="ux4g-body-m-default">{children}</div>
      {actionLabel && onAction ? (
        <Button variant="outline-primary" onClick={onAction} disabled={actionBusy}>
          {actionBusy ? 'Refreshing…' : actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
