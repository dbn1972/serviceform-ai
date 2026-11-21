import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { FEE_TEMPLATES } from '@serviceform/studio-designers/fee';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Fee designer - ServiceForm AI - Service Design Studio',
};

export default function FeesPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Fee designer</h1>
        <p className="ux4g-body-m-default">
          Author fee schedules as CMP-033 FEE metadata (amount_minor lines). SAMPLE_LAB_DUMMY
          overlays are labeled so they are never mistaken for statute. Freeze and pin through
          maker-checker — the designer never publishes alone.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-033 · CMP-051 · CMP-052 · CMP-020/021</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB_DUMMY OK · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank fee schedule"
          subtitle="One zero-amount line"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/fees/designer">
                New blank fee schedule
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Use SAMPLE_LAB_DUMMY labels for lab overlays; Residence remains ₹0 unless policy says
            otherwise.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 FEE documents">
          <OpenDraft action="/fees/designer" kind="FEE" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Synthetic SAMPLE_LAB fee overlays">
        <ul className="sf-designer-recent">
          {FEE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink href={`/fees/designer?template=${t.id}`}>{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
