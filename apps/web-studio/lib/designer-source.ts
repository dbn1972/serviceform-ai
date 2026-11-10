import { templateById, type FormPackage } from '@serviceform/service-templates';

export type DesignerSource =
  | { kind: 'blank' }
  | { kind: 'template'; form: FormPackage; version: string; source: string; label: string }
  | { kind: 'document'; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function nextMinor(version: string): string {
  const [major, minor] = version.split('.').map(Number);
  return Number.isInteger(major) && Number.isInteger(minor)
    ? `${major}.${(minor ?? 0) + 1}.0`
    : '1.0.0';
}

/** What the designer opens: a saved CMP-033 draft, a new version of a template, or a blank form. */
export function designerSource(
  params: Record<string, string | string[] | undefined>,
): DesignerSource {
  const document = one(params['document']);
  if (document && UUID_RE.test(document)) return { kind: 'document', id: document };
  const template = templateById(one(params['template']) ?? '');
  if (template) {
    const wanted = one(params['v']);
    const version =
      template.versions.find((v) => v.version === wanted) ??
      template.versions[template.versions.length - 1];
    if (version) {
      return {
        kind: 'template',
        form: version.form,
        version: nextMinor(version.version),
        source: `${template.template_id}@${version.version}`,
        label: `${template.name} v${version.version}`,
      };
    }
  }
  return { kind: 'blank' };
}
