import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  catalogueIdForFormVersion,
  diffVersions,
  formFields,
  formPin,
  listTemplates,
  policyInputsPending,
  publishedVersion,
  stepLabels,
  templateByCatalogueId,
  templateById,
  TEMPLATE_REGISTRY_SOURCE,
  type UiElement,
} from '../src/index';
import { assertVersionIntegrity, formContentHash } from '../src/integrity';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const registry = JSON.parse(readFileSync(join(ROOT, TEMPLATE_REGISTRY_SOURCE.path), 'utf8')) as {
  catalogue_version: string;
  canonical_services: Record<string, string>[];
};
const bindings = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/lab/platform/published-bindings.json'), 'utf8'),
) as { bindings: { catalogue_id: string; pins: { form_version_id: string } }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const templates = listTemplates();

function scopes(node: UiElement): string[] {
  if (node.type === 'Control') return [node.scope];
  return node.elements.flatMap(scopes);
}

const scopeToPointer = (scope: string) =>
  scope.replace('#/properties/', '/').replaceAll('/properties/', '/');

// REQ: catalogue grounded in docs/catalogue; published metadata immutable (Constitution).
describe('template catalogue (SAMPLE_LAB)', () => {
  it('offers the Residence template and at least three stubs', () => {
    expect(templates.filter((t) => t.maturity === 'SAMPLE_LAB_PUBLISHED')).toHaveLength(1);
    expect(templates.filter((t) => t.maturity === 'SAMPLE_LAB_STUB').length).toBeGreaterThanOrEqual(
      3,
    );
    expect(new Set(templates.map((t) => t.catalogue_id)).size).toBe(templates.length);
    expect(templateByCatalogueId('IND-SOC-002')?.name).toBe('Residence Certificate');
    expect(templateById('ind-soc-031.income-certificate')?.catalogue_id).toBe('IND-SOC-031');
    expect(templateByCatalogueId('IND-NOPE-000')).toBeNull();
  });

  it.each(templates.map((t) => [t.catalogue_id, t] as const))(
    '%s matches the normalized registry entry',
    (id, t) => {
      expect(registry.catalogue_version).toBe(TEMPLATE_REGISTRY_SOURCE.catalogue_version);
      const entry = registry.canonical_services.find((e) => e['Canonical Service ID'] === id);
      expect(entry, id).toBeDefined();
      expect(t.category).toBe(entry?.['Category']);
      expect(t.output_type).toBe(entry?.['Service / Output Type']);
      expect(t.definition).toBe(entry?.['Definition']);
      expect(t.issuing_authority_class).toBe(entry?.['Typical Issuing Authority']);
      expect(t.lifecycle_class).toBe(entry?.['Lifecycle / Validity Class']);
      expect(t.credential_form).toBe(entry?.['Recommended Credential Form']);
      expect(t.digilocker_suitability).toBe(entry?.['DigiLocker / Wallet Suitability']);
      expect([...t.core_fields]).toEqual(entry?.['Recommended Core Fields']?.split('; '));
    },
  );

  it('stubs invent no policy and have no PUBLISHED version', () => {
    for (const t of templates.filter((x) => x.maturity === 'SAMPLE_LAB_STUB')) {
      expect(publishedVersion(t)).toBeNull();
      expect(t.versions.every((v) => v.status === 'DRAFT')).toBe(true);
      expect([
        t.policy.fee,
        t.policy.service_time,
        t.policy.eligibility,
        t.policy.evidence,
      ]).toEqual(Array(4).fill('POLICY_INPUT_REQUIRED'));
      expect(t.indicative_checks).toEqual([]);
    }
    // M11: Income has a Studio authoring shell; other stubs stay path-null until configured.
    expect(templateByCatalogueId('IND-SOC-031')?.authoring_path).toBe(
      'templates/income-certificate/',
    );
    expect(templateByCatalogueId('IND-SOC-001')?.authoring_path).toBeNull();
    expect(templateByCatalogueId('IND-CIV-001')?.authoring_path).toBeNull();
  });

  it('every version has a unique UUID, ascending semver and a matching content hash', () => {
    const ids = templates.flatMap((t) => t.versions.map((v) => v.version_id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      const rank = (v: string) => v.split('.').reduce((acc, part) => acc * 1000 + Number(part), 0);
      const ranks = t.versions.map((v) => rank(v.version));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(new Set(ranks).size).toBe(ranks.length);
      for (const v of t.versions) {
        expect(v.version_id).toMatch(UUID);
        expect(v.content_hash).toBe(formContentHash(v.form));
        expect(() => assertVersionIntegrity(v)).not.toThrow();
        expect(v.status === 'PUBLISHED').toBe(v.published_at !== null);
      }
    }
  });

  it('PUBLISHED Residence 1.0.0 is frozen (the TSB pins its id and hash)', () => {
    const t = templateByCatalogueId('IND-SOC-002');
    const v = t && publishedVersion(t);
    expect(v?.version).toBe('1.0.0');
    expect(v?.form.form_id).toBe(['ind-soc-002', 'application'].join('.'));
    expect(v?.content_hash).toBe(
      'sha256:6b659df18272546c28799bd1b0b7bf6d2a5b372864418ed82981ecee6de02562',
    );
    const pinned = bindings.bindings.find((b) => b.catalogue_id === 'IND-SOC-002');
    expect(v && formPin(v)).toEqual({
      form_key: v?.form.form_id,
      version_id: pinned?.pins.form_version_id,
      content_hash: v?.content_hash,
    });
    const tampered = v && { ...v, form: { ...v.form, form_id: 'ind-soc-002.tampered' } };
    expect(() => tampered && assertVersionIntegrity(tampered)).toThrow(/content hash mismatch/);
  });

  it.each(
    templates.flatMap((t) => t.versions.map((v) => [`${t.template_id}@${v.version}`, v] as const)),
  )('%s: UI controls and schema fields agree; last step is a review', (_id, v) => {
    const ui = scopes(v.form.ui_schema).map(scopeToPointer).sort();
    const fields = formFields(v.form.json_schema)
      .map((f) => f.pointer)
      .sort();
    expect(ui).toEqual(fields);
    const last = v.form.ui_schema.elements[v.form.ui_schema.elements.length - 1];
    expect(last?.type === 'Category' && last.options?.review).toBe(true);
    expect(stepLabels(v).length).toBeGreaterThanOrEqual(3);
  });

  it('sample data is synthetic only', () => {
    for (const v of templates.flatMap((t) => t.versions)) {
      if (!v.sample_data) continue;
      expect(String(v.sample_data['applicant_name'])).toMatch(/^SAMPLE /);
      expect(JSON.stringify(v.sample_data)).not.toMatch(/[0-9]{12}/);
    }
  });

  it('maps form version ids to catalogue ids and detects pending policy (M11)', () => {
    expect(catalogueIdForFormVersion('0d15ba00-0010-4000-8000-0d15ba000010')).toBe('IND-SOC-002');
    expect(catalogueIdForFormVersion('7e3a0031-0001-4000-8000-00000000031a')).toBe('IND-SOC-031');
    expect(catalogueIdForFormVersion('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(policyInputsPending(templateByCatalogueId('IND-SOC-031')!)).toBe(true);
    expect(policyInputsPending(templateByCatalogueId('IND-SOC-002')!)).toBe(false);
  });

  it('diffs versions at field level', () => {
    const t = templateByCatalogueId('IND-SOC-002');
    const [v1, v11] = t?.versions ?? [];
    if (!v1 || !v11) throw new Error('missing versions');
    const diff = diffVersions(v1, v11);
    expect(diff.added.map((f) => f.pointer)).toEqual(['/guardian_name']);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diffVersions(v11, v1).removed.map((f) => f.pointer)).toEqual(['/guardian_name']);
  });
});
