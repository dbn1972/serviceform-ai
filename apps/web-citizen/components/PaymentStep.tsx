'use client';

import { Alert, Button } from '@serviceform/ui-ux4g';
import { useCallback, useEffect, useState } from 'react';
import { FormAlert } from './FormFeedback';

type FeeQuoteView = {
  quote_id: string | null;
  currency: string;
  total_amount_minor: number;
  amount_display: string;
  client_authoritative_amount: false;
  policy_kind: string;
  pending_quote?: boolean;
};

type Props = {
  applicationId: string;
  onPaid: () => void;
};

/**
 * Thin SAMPLE_LAB DUMMY fee>0 pay step (SF-56).
 * Amount comes from server quote / catalogue — never from the client.
 * Pay CTA runs SIMULATED PSP callback only. CERTIFIED=false. G6=false.
 */
export function PaymentStep({ applicationId, onPaid }: Props) {
  const [quote, setQuote] = useState<FeeQuoteView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/applications/${applicationId}/payment`);
    const body = (await res.json().catch(() => ({}))) as {
      fee_quote?: FeeQuoteView;
      message?: string;
      payment_required?: boolean;
    };
    if (!res.ok) {
      setError(body.message ?? 'Could not load fee details.');
      return;
    }
    if (!body.payment_required) {
      onPaid();
      return;
    }
    setQuote(body.fee_quote ?? null);
  }, [applicationId, onPaid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/portal/applications/${applicationId}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'SIMULATED payment did not complete.');
        return;
      }
      onPaid();
    } finally {
      setBusy(false);
    }
  }

  if (!quote) {
    return (
      <section className="sf-stack" aria-live="polite">
        {error ? <FormAlert tone="error">{error}</FormAlert> : <p>Loading fee…</p>}
      </section>
    );
  }

  const rupees = (quote.total_amount_minor / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <section className="sf-stack" aria-labelledby="lab-fee-heading">
      <h2 id="lab-fee-heading" className="ux4g-heading-l-strong">
        Fee payment required
      </h2>
      <p className="ux4g-body-m-default">
        Pay the fee shown below to continue. The amount comes from the service fee policy — you
        cannot change it.
      </p>
      <Alert variant="info" title="Sample lab — not production payment">
        This is a simulated payment in SAMPLE_LAB. No real money is taken.
      </Alert>
      <dl className="sf-dl">
        <div>
          <dt>Amount</dt>
          <dd>
            ₹{rupees} <span className="ux4g-tag-tonal-neutral">{quote.amount_display}</span>
          </dd>
        </div>
        <div>
          <dt>Payment method</dt>
          <dd>Simulated payment (lab only)</dd>
        </div>
      </dl>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button type="button" onClick={() => void pay()} disabled={busy}>
        {busy ? 'Processing…' : 'Pay (simulated)'}
      </Button>
    </section>
  );
}
