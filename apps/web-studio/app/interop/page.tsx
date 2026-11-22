import { AppShell } from '@serviceform/ui-ux4g';
import { InteropHygieneDesk } from '../../components/InteropHygieneDesk';
import { StudioNav } from '../../components/StudioNav';

export default function InteropPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Interop hygiene"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">BPMN / .sfpackage lab demo</h1>
        <p className="ux4g-body-m-default">
          Interoperability hygiene for SAMPLE_LAB: BPMN profile round-trip, signed service package
          promotion checks, and explicit in-flight migration dry-run. No Camunda second runtime.
        </p>
        <span className="ux4g-tag-tonal-info">Temporal runtime · BPMN interop only</span>
      </section>
      <InteropHygieneDesk />
    </AppShell>
  );
}
