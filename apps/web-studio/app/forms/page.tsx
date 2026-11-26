import { TextLink } from '@serviceform/ui-ux4g';
import { latestVersion, listTemplates } from '@serviceform/service-templates';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';
import { MATURITY_LABEL, STATUS_TAG } from '../../lib/templates';

export const metadata: Metadata = {
  title: 'Forms designer - ServiceForm AI - Service Design Studio',
};

export default function FormsPage() {
  const templates = listTemplates();
  return (
    <DesignerHub
      title="Forms designer"
      description="Design application forms visually. Each version compiles to a form package (JSON Schema + UX4G layout), is frozen when published, and is pinned by its content hash. A form goes live only when a different officer approves the service binding that pins it."
      blankTitle="Start a blank form"
      blankSubtitle="One step and an empty section"
      blankHref="/forms/designer"
      blankCta="New blank form"
      blankBody="Add fields from the palette, including common government fields bound to canonical semantic elements."
      draftAction="/forms/designer"
      draftKind="FORM"
      draftSubtitle="Saved form drafts in this browser"
      templatesTitle="Start from a catalogue template"
      templatesSubtitle="The designer opens a new version"
      heroSecondary={{ href: '/forms/metrics', label: 'Forms product KPIs' }}
      templatesSlot={
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
      }
    />
  );
}
