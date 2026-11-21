import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { SLA_TEMPLATES } from '@serviceform/studio-designers/sla';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'SLA designer - ServiceForm AI - Service Design Studio',
};

export default function SlaPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">SLA designer</h1>
        <p className="ux4g-body-m-default">
          Author SLA clocks as CMP-033 SLA metadata (ISO-8601 durations). Runtime evaluation stays
          with CMP-029. SAMPLE_LAB overlays must not invent statutory deadlines.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-033 · CMP-051 · CMP-052 · CMP-029</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank SLA pack"
          subtitle="One processing clock"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/sla/designer">
                New blank SLA pack
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Pause reasons such as DEFICIENCY_OPEN align with the lab deficiency path.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 SLA documents">
          <OpenDraft action="/sla/designer" kind="SLA" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Synthetic SAMPLE_LAB SLA overlays">
        <ul className="sf-designer-recent">
          {SLA_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink href={`/sla/designer?template=${t.id}`}>{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
