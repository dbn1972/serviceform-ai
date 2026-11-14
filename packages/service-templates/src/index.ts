import { RESIDENCE_CERTIFICATE } from './catalogue/residence';
import { BIRTH_CERTIFICATE, DOMICILE_CERTIFICATE, INCOME_CERTIFICATE } from './catalogue/stubs';
import type { CertificateTemplate, FormSchemaNode, TemplateVersion, UiLayout } from './types';

export type * from './types';

export const TEMPLATE_CATALOGUE_VERSION = '2026.11.0';
export const TEMPLATE_REGISTRY_SOURCE = {
  path: 'docs/catalogue/India_Gov_Normalized_Service_Registry.json',
  catalogue_version: '1.0',
} as const;

const TEMPLATES: readonly CertificateTemplate[] = [
  RESIDENCE_CERTIFICATE,
  INCOME_CERTIFICATE,
  DOMICILE_CERTIFICATE,
  BIRTH_CERTIFICATE,
];

export function listTemplates(): readonly CertificateTemplate[] {
  return TEMPLATES;
}

export function templateByCatalogueId(catalogueId: string): CertificateTemplate | null {
  return TEMPLATES.find((t) => t.catalogue_id === catalogueId) ?? null;
}

export function templateById(templateId: string): CertificateTemplate | null {
  return TEMPLATES.find((t) => t.template_id === templateId) ?? null;
}

/** Latest PUBLISHED version; versions are listed oldest first. */
export function publishedVersion(template: CertificateTemplate): TemplateVersion | null {
  return [...template.versions].reverse().find((v) => v.status === 'PUBLISHED') ?? null;
}

const PENDING = 'POLICY_INPUT_REQUIRED';

/**
 * True when fee/service_time/eligibility/evidence still require statutory owner input.
 * M11: stubs with pending policy must not be offered even if a form version were published.
 */
export function policyInputsPending(template: CertificateTemplate): boolean {
  const p = template.policy;
  return [p.fee, p.service_time, p.eligibility, p.evidence].includes(PENDING);
}

/** Catalogue id whose form version UUID matches, or null. */
export function catalogueIdForFormVersion(formVersionId: string): string | null {
  for (const t of TEMPLATES) {
    if (t.versions.some((v) => v.version_id === formVersionId)) return t.catalogue_id;
  }
  return null;
}

export function latestVersion(template: CertificateTemplate): TemplateVersion {
  const last = template.versions[template.versions.length - 1];
  if (!last) throw new Error(`Template ${template.template_id} has no versions`);
  return last;
}

export function formPin(version: TemplateVersion) {
  return {
    form_key: version.form.form_id,
    version_id: version.version_id,
    content_hash: version.content_hash,
  };
}

export interface FieldEntry {
  pointer: string;
  title: string;
  type: string;
  required: boolean;
}

/** Flattened leaf fields of a form schema (object properties expanded), in schema order. */
export function formFields(schema: FormSchemaNode, base = ''): FieldEntry[] {
  const out: FieldEntry[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, node] of Object.entries(schema.properties ?? {})) {
    const pointer = `${base}/${name}`;
    if (node.type === 'object' && node.properties) {
      out.push(...formFields(node, pointer));
      continue;
    }
    out.push({
      pointer,
      title: node.title ?? name,
      type: node.format ?? (node.enum ? 'choice' : (node.type ?? 'string')),
      required: required.has(name),
    });
  }
  return out;
}

export interface VersionDiff {
  added: FieldEntry[];
  removed: FieldEntry[];
  changed: { pointer: string; title: string }[];
}

/** Field-level change between two versions of a template (Studio version history). */
export function diffVersions(from: TemplateVersion, to: TemplateVersion): VersionDiff {
  const a = new Map(formFields(from.form.json_schema).map((f) => [f.pointer, f]));
  const b = new Map(formFields(to.form.json_schema).map((f) => [f.pointer, f]));
  const added = [...b.values()].filter((f) => !a.has(f.pointer));
  const removed = [...a.values()].filter((f) => !b.has(f.pointer));
  const changed = [...b.values()]
    .filter((f) => {
      const prev = a.get(f.pointer);
      return (
        prev && (prev.title !== f.title || prev.type !== f.type || prev.required !== f.required)
      );
    })
    .map((f) => ({ pointer: f.pointer, title: f.title }));
  return { added, removed, changed };
}

/** Number of wizard steps (Categorization categories) in a form. */
export function stepLabels(version: TemplateVersion): string[] {
  const ui = version.form.ui_schema;
  if (ui.type !== 'Categorization') return [ui.label ?? 'Form'];
  return ui.elements.filter((e): e is UiLayout => e.type === 'Category').map((c) => c.label ?? '');
}
