'use client';

import { Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { forwardRef, type ReactNode } from 'react';

export type FormAlertTone = 'error' | 'warning' | 'success' | 'info';

const TONE_ICON = {
  error: 'alert',
  warning: 'alert',
  success: 'check-circle',
  info: 'info',
} as const;
const TONE_CLASS = {
  error: 'ux4g-alert-error',
  warning: 'ux4g-alert-warning',
  success: 'sf-tone-success',
  info: 'sf-tone-info',
} as const;

export type FormAlertProps = {
  tone?: FormAlertTone;
  title?: string;
  children: ReactNode;
  action?: { href: string; label: string } | undefined;
  testId?: string;
};

/** UX4G `ux4g-form-alert` for in-form outcomes (errors need role=alert; others are status). */
export function FormAlert({ tone = 'error', title, children, action, testId }: FormAlertProps) {
  return (
    <div
      className={`ux4g-form-alert ${TONE_CLASS[tone]} sf-auth-notice`}
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      <span className="ux4g-alert-icon">
        <Icon name={TONE_ICON[tone]} />
      </span>
      <div className="ux4g-form-alert-body">
        {title ? <p className="ux4g-label-s-strong">{title}</p> : null}
        <p>{children}</p>
        {action ? (
          <p>
            <Link className="sf-auth-inline-link" href={action.href}>
              {action.label}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type ErrorSummaryItem = { fieldId: string; message: string };

/** Error summary that receives focus on submit and links each message to its field. */
export const ErrorSummary = forwardRef<HTMLDivElement, { items: readonly ErrorSummaryItem[] }>(
  function ErrorSummary({ items }, ref) {
    return (
      <div
        ref={ref}
        className="ux4g-form-alert ux4g-alert-error sf-auth-error-summary"
        role="alert"
        tabIndex={-1}
        aria-labelledby="error-summary-title"
        data-testid="error-summary"
      >
        <span className="ux4g-alert-icon">
          <Icon name="alert" />
        </span>
        <div className="ux4g-form-alert-body">
          <p id="error-summary-title" className="ux4g-label-s-strong ux4g-text-error">
            There is a problem
          </p>
          <ul className="sf-auth-error-list">
            {items.map((item) => (
              <li key={item.fieldId}>
                <a
                  href={`#${item.fieldId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(item.fieldId)?.focus();
                  }}
                >
                  {item.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  },
);
