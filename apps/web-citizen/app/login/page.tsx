import { AppShell, Alert } from '@serviceform/ui-ux4g';
import { Suspense } from 'react';
import { CitizenLoginForm } from '../../components/CitizenLoginForm';
import { CitizenNav } from '../../components/CitizenNav';

export default function LoginPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Citizen sign-in</h1>
        <p className="ux4g-body-m-default">
          Start the Residence Certificate journey with a SIMULATED SAMPLE_LAB identity.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-warning">SIMULATED OTP</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
        </div>
      </section>

      <Alert variant="info" title="What happens next">
        After sign-in you will see available services, open Residence Certificate, apply, track
        status, and publish to DigiLocker (SIMULATED) once an officer issues the credential.
      </Alert>

      <Suspense fallback={<p className="ux4g-body-m-default">Loading sign-in…</p>}>
        <CitizenLoginForm />
      </Suspense>
    </AppShell>
  );
}
