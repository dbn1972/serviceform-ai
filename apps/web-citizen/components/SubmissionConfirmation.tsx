'use client';

import { Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

/**
 * One-off confirmation on arrival from a successful submit: the reference to keep and what happens
 * next. Focus moves to its heading so screen readers announce the outcome. Submitting is never a
 * decision; the officer decides after verification.
 */
export function SubmissionConfirmation({
  reference,
  status,
}: {
  reference: string;
  status: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const payment = status === 'PAYMENT_REQUIRED';

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="sf-confirm"
      aria-labelledby="confirm-title"
      data-testid="submission-confirmation"
    >
      <span className="sf-confirm-mark" aria-hidden="true">
        <Icon name="check" size={28} />
      </span>
      <div className="sf-confirm-body">
        <h2 id="confirm-title" ref={headingRef} tabIndex={-1} className="ux4g-heading-m-strong">
          {payment ? 'Application received' : 'Application submitted'}
        </h2>
        <p className="sf-confirm-ref">
          <span className="ux4g-label-m-default">Your reference number</span>
          <span className="ux4g-heading-l-strong" data-testid="confirmation-reference">
            {reference}
          </span>
        </p>
        <p className="ux4g-body-m-default">
          {payment
            ? 'Pay the fee below to send your application to the office.'
            : 'Keep this reference. You can follow this application from My applications at any time.'}
        </p>
        <h3 className="ux4g-heading-xs-strong">What happens next</h3>
        <ol className="sf-confirm-next ux4g-body-m-default">
          {payment ? (
            <li>Pay the fee (SIMULATED in SAMPLE_LAB). The office starts once it is paid.</li>
          ) : null}
          <li>An officer checks your answers and document. Submitting is not a decision.</li>
          <li>If anything is missing, this page will say what to send.</li>
          <li>Once the certificate is issued, you can save it to DigiLocker (SIMULATED).</li>
        </ol>
        <p className="ux4g-body-s-default">
          <Link href="/certificates">See all your applications</Link>
        </p>
      </div>
    </section>
  );
}
