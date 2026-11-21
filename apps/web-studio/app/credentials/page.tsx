import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { CREDENTIAL_TEMPLATES } from '@serviceform/studio-designers/credential';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Credential designer - ServiceForm AI - Service Design Studio',
};

export default function CredentialsPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Credential designer</h1>
        <p className="ux4g-body-m-default">
          Author credential templates as CMP-033 CREDENTIAL metadata (template_key and DigiLocker
          labels). SAMPLE_LAB uses SIM publish; REAL DigiLocker remains owner-held for G6.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-033 · CMP-051 · CMP-052 · CMP-022+</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · SIM · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank credential template"
          subtitle="One template key and DigiLocker label"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/credentials/designer">
                New blank credential template
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Keep DigiLocker labels clearly SAMPLE_LAB_DUMMY when using lab overlays.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 CREDENTIAL documents">
          <OpenDraft action="/credentials/designer" kind="CREDENTIAL" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Synthetic SAMPLE_LAB credential overlays">
        <ul className="sf-designer-recent">
          {CREDENTIAL_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink
                href={`/credentials/designer?template=${t.id}`}
              >{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
