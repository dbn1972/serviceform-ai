import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { FormsMetricsPanel } from '../../../components/forms/FormsMetricsPanel';
import { StudioNav } from '../../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Forms KPIs - ServiceForm AI - Service Design Studio',
};

export default function FormsMetricsPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Forms product KPIs</h1>
        <p className="ux4g-body-m-default">
          Durable measure surface for Studio authoring, citizen funnel, latency p95, a11y score, and
          zero cross-tenant incidents. OTLP-shaped export is available from
          @serviceform/forms-product-metrics (web-safe; no observability backend import).
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">P8-1 · D7 Measure</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · CERTIFIED=false</span>
          <span className="ux4g-tag-outline-neutral">DigiLocker out of scope</span>
        </div>
      </section>
      <FormsMetricsPanel />
    </AppShell>
  );
}
