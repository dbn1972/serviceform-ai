import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { latestVersion, listTemplates } from '@serviceform/service-templates';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';
import { MATURITY_LABEL, STATUS_TAG } from '../../lib/templates';

export const metadata: Metadata = {
  title: 'Forms designer - ServiceForm AI - Service Design Studio',
};

export default function FormsPage() {
  const templates = listTemplates();
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Forms designer</h1>
        <p className="ux4g-body-m-default">
          Design application forms visually. Each version compiles to a CMP-009 FORM package (JSON
          Schema + UX4G layout), is frozen in CMP-033 and pinned by its content hash. A form goes
          live only when a different officer approves the service binding that pins it.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-009 · CMP-033 · CMP-051 · CMP-052</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
        </div>
      </section>

      <div className="sf-designer-start">
        <Card
          title="Start a blank form"
          subtitle="One step and an empty section"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/forms/designer">
                New blank form
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Add fields from the palette, including common government fields bound to canonical
            semantic elements.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 FORM documents">
          <OpenDraft />
        </Card>
      </div>

      <Card title="Start from a catalogue template" subtitle="The designer opens a new version">
        <div className="sf-table-wrap">
          <table className="sf-table">
            <caption>Versioned certificate templates</caption>
            <thead>
              <tr>
                <th scope="col">Template</th>
                <th scope="col">Maturity</th>
                <th scope="col">Latest version</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const latest = latestVersion(t);
                return (
                  <tr key={t.template_id}>
                    <th scope="row">
                      {t.name}
                      <br />
                      <code className="sf-hash">{t.catalogue_id}</code>
                    </th>
                    <td>{MATURITY_LABEL[t.maturity]}</td>
                    <td className="sf-nowrap">
                      v{latest.version}{' '}
                      <span className={STATUS_TAG[latest.status]}>{latest.status}</span>
                    </td>
                    <td>
                      <TextLink
                        href={`/forms/designer?template=${t.template_id}&v=${latest.version}`}
                      >
                        {`Open ${t.name} in designer`}
                      </TextLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
