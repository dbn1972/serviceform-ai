import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { EVIDENCE_TEMPLATES } from '@serviceform/studio-designers/evidence';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Evidence designer - ServiceForm AI - Service Design Studio',
};

export default function EvidencePage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Evidence designer</h1>
        <p className="ux4g-body-m-default">
          Author evidence requirements as CMP-033 EVIDENCE metadata. Technical upload accept is not
          business verification. SAMPLE_LAB_DUMMY labels are allowed for lab overlays.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-033 · CMP-051 · CMP-052 · CMP-013</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB_DUMMY OK · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank evidence pack"
          subtitle="One proof-of-address requirement"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/evidence/designer">
                New blank evidence pack
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Officers still verify meaning; deficiency and resubmit stay on the case path.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 EVIDENCE documents">
          <OpenDraft action="/evidence/designer" kind="EVIDENCE" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Synthetic SAMPLE_LAB evidence overlays">
        <ul className="sf-designer-recent">
          {EVIDENCE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink href={`/evidence/designer?template=${t.id}`}>{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
