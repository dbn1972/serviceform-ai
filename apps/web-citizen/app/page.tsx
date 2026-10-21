'use client';

import { AppShell, Alert, Card, TextLink, Button } from '@serviceform/ui-ux4g';
import { useEffect, useState } from 'react';
import { CitizenNav } from '../components/CitizenNav';

type Session = { authenticated: boolean; display_name?: string };

export default function HomePage() {
  const [session, setSession] = useState<Session>({ authenticated: false });

  useEffect(() => {
    void fetch('/api/lab/session')
      .then((r) => r.json())
      .then((body: Session) => setSession(body));
  }, []);

  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Citizen Portal</h1>
        <p className="ux4g-body-m-default">
          Apply for services, track applications, and publish issued credentials to DigiLocker
          (SIMULATED in this lab).
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">IND-SOC-002</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
        </div>
      </section>

      {!session.authenticated ? (
        <Card
          title="Start here — sign in"
          subtitle="SAMPLE_LAB simulated citizen identity"
          footer={
            <div className="sf-actions">
              <TextLink href="/login">Sign in</TextLink>
              <TextLink href="/register">Create an account</TextLink>
            </div>
          }
        >
          <Alert variant="warning" title="Sign-in required for the journey">
            Login → Services → Residence Certificate → Apply → Track → DigiLocker (SIMULATED).
          </Alert>
          <p className="ux4g-body-m-default">
            Use synthetic name <strong>SAMPLE LAB Citizen</strong>, mobile{' '}
            <strong>9876543210</strong>, OTP <strong>123456</strong>.
          </p>
        </Card>
      ) : (
        <Card
          title={`Welcome, ${session.display_name}`}
          subtitle="You are signed into SAMPLE_LAB"
          footer={
            <div className="sf-actions">
              <TextLink href="/services">Browse services</TextLink>
              <TextLink href="/certificates">My certificates</TextLink>
              <Button
                variant="text-neutral"
                onClick={() => {
                  void fetch('/api/lab/session', { method: 'DELETE' }).then(() => {
                    setSession({ authenticated: false });
                  });
                }}
              >
                Sign out
              </Button>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Continue the Residence Certificate journey from the services catalogue.
          </p>
        </Card>
      )}
    </AppShell>
  );
}
