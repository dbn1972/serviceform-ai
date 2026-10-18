import { AppShell } from '@serviceform/ui-ux4g';
import { CitizenNav } from '../../../components/CitizenNav';
import { ResidenceApplyForm } from '../../../components/ResidenceApplyForm';

export default function ResidenceServicePage() {
  return (
    <AppShell
      surface="citizen_web"
      title="Citizen Portal"
      environmentLabel="SAMPLE_LAB"
      nav={<CitizenNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Residence Certificate</h1>
        <p className="ux4g-body-m-default">
          Service code IND-SOC-002 · authored as Studio metadata · SAMPLE_LAB path only.
        </p>
      </section>
      <ResidenceApplyForm />
    </AppShell>
  );
}
