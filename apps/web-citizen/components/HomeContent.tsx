'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ApplicationSummary } from '../lib/ind-soc-002';
import { useCitizenSession } from '../lib/use-citizen-session';
import { ApplicationCard } from './ApplicationCard';
import type { ServiceFacts } from './auth/AuthContextPanel';
import { CitizenPageHeader } from './CitizenPageHeader';
import { ServiceTile } from './ServiceTile';

export function HomeContent({ service }: { service: ServiceFacts }) {
  const session = useCitizenSession();
  const signedIn = session.status === 'signed-in';
  const [latest, setLatest] = useState<ApplicationSummary | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    void fetch('/api/lab/applications?mine=1')
      .then((r) => r.json())
      .then((body: { applications?: ApplicationSummary[] }) =>
        setLatest(body.applications?.[0] ?? null),
      );
  }, [signedIn]);

  return (
    <>
      <CitizenPageHeader
        eyebrow={
          signedIn ? `Welcome back, ${session.profile.display_name}` : 'Government services, online'
        }
        title="Citizen Portal"
        lead={
          signedIn
            ? 'Pick up where you left off, or start a new application.'
            : 'Apply for certificates, track every application and receive documents digitally — with one mobile-verified account.'
        }
        actions={
          session.status === 'loading' ? null : signedIn ? (
            <>
              <Link className="ux4g-btn-outline-neutral ux4g-btn-l" href="/certificates">
                My applications
              </Link>
              <Link className="sf-hero-link" href="/services">
                Browse services
              </Link>
            </>
          ) : (
            <>
              <Link className="ux4g-btn-outline-neutral ux4g-btn-l" href="/login">
                Sign in
              </Link>
              <Link className="sf-hero-link" href="/register">
                Create an account
              </Link>
            </>
          )
        }
      />

      {signedIn && latest ? (
        <section className="sf-section" aria-labelledby="home-latest">
          <h2 id="home-latest" className="ux4g-heading-s-strong sf-section-title">
            Your latest application
          </h2>
          <ApplicationCard app={latest} headingLevel={3} />
        </section>
      ) : null}

      <section className="sf-section" aria-labelledby="home-services">
        <h2 id="home-services" className="ux4g-heading-s-strong sf-section-title">
          Popular service
        </h2>
        <ServiceTile service={service} headingLevel={3} />
      </section>

      <section className="sf-panel" aria-labelledby="home-how">
        <h2 id="home-how" className="ux4g-heading-s-strong">
          How it works
        </h2>
        <ol className="sf-steps-light">
          <li>
            <span>
              <strong>Verify your mobile number</strong>
              Sign in with a one-time password — no password to remember.
            </span>
          </li>
          <li>
            <span>
              <strong>Apply online</strong>
              Your verified details are pre-filled; attach one supporting document.
            </span>
          </li>
          <li>
            <span>
              <strong>Track and receive</strong>
              Follow each step and keep the certificate in DigiLocker (SIMULATED).
            </span>
          </li>
        </ol>
      </section>
    </>
  );
}
