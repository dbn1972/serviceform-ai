'use client';

import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../../../components/CitizenNav';
import { RequireCitizenSession } from '../../../../components/RequireCitizenSession';
import { ResidenceApplyForm } from '../../../../components/ResidenceApplyForm';

export default function ResidenceApplyPage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <RequireCitizenSession>
        <section className="sf-page-hero">
          <h1 className="ux4g-heading-2xl-strong">Apply — Residence Certificate</h1>
          <p className="ux4g-body-m-default">
            Four steps: applicant → residence → evidence → preview &amp; submit. Fee ₹0 · SAMPLE_LAB
            only.
          </p>
        </section>
        <ResidenceApplyForm />
      </RequireCitizenSession>
    </AppShell>
  );
}
