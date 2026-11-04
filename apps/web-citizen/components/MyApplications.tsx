'use client';

import { Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ApplicationSummary } from '../lib/ind-soc-002';
import { ApplicationCard } from './ApplicationCard';
import { FormAlert } from './FormFeedback';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; apps: ApplicationSummary[] };

export function MyApplications() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    void fetch('/api/lab/applications?mine=1')
      .then(async (r) => {
        const body = (await r.json()) as { applications?: ApplicationSummary[]; message?: string };
        setState(
          r.ok
            ? { status: 'ready', apps: body.applications ?? [] }
            : { status: 'error', message: body.message ?? 'Could not load your applications' },
        );
      })
      .catch(() => setState({ status: 'error', message: 'Could not load your applications' }));
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="sf-gate" role="status">
        <span className="sf-spinner" aria-hidden="true" />
        <p className="ux4g-body-m-default">Loading your applications…</p>
      </div>
    );
  }
  if (state.status === 'error') return <FormAlert tone="error">{state.message}</FormAlert>;
  if (state.apps.length === 0) {
    return (
      <section className="sf-empty" aria-labelledby="apps-empty" data-testid="applications-empty">
        <span className="sf-service-mark">
          <Icon name="document" size={24} />
        </span>
        <h2 id="apps-empty" className="ux4g-heading-s-strong">
          You have no applications yet
        </h2>
        <p className="ux4g-body-m-default">
          Applications you submit with this account appear here with their status.
        </p>
        <Link className="ux4g-btn-primary ux4g-btn-m" href="/services/IND-SOC-002/apply">
          Apply for a Residence Certificate
          <Icon name="arrow-right" size={18} />
        </Link>
      </section>
    );
  }
  return (
    <ul className="sf-app-list" aria-label="Your applications">
      {state.apps.map((app) => (
        <li key={app.id}>
          <ApplicationCard app={app} />
        </li>
      ))}
    </ul>
  );
}
