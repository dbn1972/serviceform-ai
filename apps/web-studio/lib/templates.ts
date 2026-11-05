import {
  formFields,
  latestVersion,
  listTemplates,
  publishedVersion,
  stepLabels,
  type CertificateTemplate,
  type TemplateVersion,
} from '@serviceform/service-templates';

export interface TemplateSummary {
  template_id: string;
  catalogue_id: string;
  name: string;
  summary: string;
  category: string;
  output_type: string;
  maturity: CertificateTemplate['maturity'];
  digilocker_suitability: CertificateTemplate['digilocker_suitability'];
  latest: { version: string; status: TemplateVersion['status'] };
  published: string | null;
  versions: number;
  steps: number;
  fields: number;
}

export function summarise(t: CertificateTemplate): TemplateSummary {
  const latest = latestVersion(t);
  return {
    template_id: t.template_id,
    catalogue_id: t.catalogue_id,
    name: t.name,
    summary: t.summary,
    category: t.category,
    output_type: t.output_type,
    maturity: t.maturity,
    digilocker_suitability: t.digilocker_suitability,
    latest: { version: latest.version, status: latest.status },
    published: publishedVersion(t)?.version ?? null,
    versions: t.versions.length,
    steps: stepLabels(latest).length,
    fields: formFields(latest.form.json_schema).length,
  };
}

export function templateSummaries(): TemplateSummary[] {
  return listTemplates().map(summarise);
}

export const MATURITY_LABEL: Record<CertificateTemplate['maturity'], string> = {
  SAMPLE_LAB_PUBLISHED: 'Published · SAMPLE_LAB',
  SAMPLE_LAB_STUB: 'Stub · policy input pending',
};

export const STATUS_TAG: Record<TemplateVersion['status'], string> = {
  PUBLISHED: 'ux4g-tag-tonal-success',
  DRAFT: 'ux4g-tag-tonal-warning',
  RETIRED: 'ux4g-tag-tonal-neutral',
};

export function shortHash(hash: string): string {
  return `${hash.slice(0, 15)}…${hash.slice(-6)}`;
}
