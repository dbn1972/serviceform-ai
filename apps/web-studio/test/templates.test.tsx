import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TemplateCatalogue } from '../components/TemplateCatalogue';
import { TemplateFormPreview } from '../components/TemplateFormPreview';
import { shortHash, templateSummaries } from '../lib/templates';
import { templateById } from '@serviceform/service-templates';

// REQ: Studio template catalogue (browse/select, versioned metadata, UX4G preview).
describe('Studio template catalogue', () => {
  it('summarises every template with its latest and published versions', () => {
    const summaries = templateSummaries();
    expect(summaries.map((s) => s.catalogue_id)).toEqual([
      'IND-SOC-002',
      'IND-SOC-031',
      'IND-SOC-001',
      'IND-CIV-001',
    ]);
    const residence = summaries[0];
    expect(residence).toMatchObject({
      maturity: 'SAMPLE_LAB_PUBLISHED',
      published: '1.0.0',
      latest: { version: '1.1.0', status: 'DRAFT' },
      versions: 2,
      steps: 4,
    });
    expect(summaries.slice(1).every((s) => s.published === null)).toBe(true);
    expect(shortHash(`sha256:${'a'.repeat(64)}`)).toBe(`sha256:aaaaaaaa…aaaaaa`);
  });

  it('renders cards with an open link per template and a live result count', () => {
    const html = renderToStaticMarkup(<TemplateCatalogue templates={templateSummaries()} />);
    expect(html.match(/<article class="sf-template-card"/g)).toHaveLength(4);
    expect(html).toContain('href="/templates/ind-soc-031.income-certificate"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('4 of 4 templates');
  });

  it('previews a version through the UX4G renderer with its sample data', () => {
    const version = templateById('ind-soc-002.residence-certificate')?.versions[0];
    if (!version) throw new Error('missing version');
    const html = renderToStaticMarkup(
      <TemplateFormPreview form={version.form} sample={version.sample_data} />,
    );
    expect(html).toContain('for="preview-applicant_name"');
    expect(html).toContain('value="SAMPLE Lab Citizen"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Preview only');
  });
});
