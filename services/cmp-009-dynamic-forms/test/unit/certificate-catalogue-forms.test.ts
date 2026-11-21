/**
 * SAMPLE_LAB form contract suite: every Certificate catalogue template (+ Birth)
 * interpret/render contract + VALID sample submit + INVALID empty/malformed path.
 * Uses CMP-009 domain runtime (no Temporal/officer). CERTIFIED=false · G6=false.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInvalidLabFormData,
  buildSampleLabFormData,
  formFields,
  listTemplates,
  SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS,
  stepLabels,
  type CertificateTemplate,
  type TemplateVersion,
} from '@serviceform/service-templates';
import { parseFormPackage } from '../../src/domain/pack.js';
import { runFormRuntime } from '../../src/domain/runtime.js';

const templates = listTemplates();
const byId = (id: string) => templates.find((t) => t.catalogue_id === id);

function offerVersion(t: CertificateTemplate): TemplateVersion {
  const published = [...t.versions].reverse().find((v) => v.status === 'PUBLISHED');
  if (published) return published;
  const draft = t.versions[t.versions.length - 1];
  if (!draft) throw new Error(`Template ${t.catalogue_id} has no versions`);
  return draft;
}

describe('certificate catalogue forms (CMP-009 runtime, all catalogueIds)', () => {
  it('covers every template in @serviceform/service-templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(159);
    expect(new Set(templates.map((t) => t.catalogue_id)).size).toBe(templates.length);
    for (const id of SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS) {
      expect(byId(id), id).toBeDefined();
    }
  });

  it.each(templates.map((t) => [t.catalogue_id, t] as const))(
    '%s: form package parses, UI/schema agree, sample VALID, empty INVALID',
    (catalogueId, template) => {
      const version = offerVersion(template);
      const pack = parseFormPackage(version.form, version.form.form_id);
      expect(pack.formId).toBe(version.form.form_id);
      expect(stepLabels(version).length).toBeGreaterThanOrEqual(2);

      const fields = formFields(version.form.json_schema).map((f) => f.pointer);
      expect(fields.length).toBeGreaterThan(0);

      const generated = buildSampleLabFormData(version.form.json_schema);
      const sample = { ...generated, ...(version.sample_data ?? {}), declaration_accepted: true };
      expect(JSON.stringify(sample)).not.toMatch(/[0-9]{12}/);
      const valid = runFormRuntime(pack.jsonSchema, pack.uiSchema, sample, {});
      expect(valid.valid, `${catalogueId} sample issues: ${JSON.stringify(valid.issues)}`).toBe(
        true,
      );
      expect(valid.requiredFields.length).toBeGreaterThan(0);

      const empty = runFormRuntime(pack.jsonSchema, pack.uiSchema, {}, {});
      expect(empty.valid).toBe(false);
      expect(empty.issues.some((i) => i.code === 'REQUIRED')).toBe(true);

      const invalid = runFormRuntime(
        pack.jsonSchema,
        pack.uiSchema,
        buildInvalidLabFormData(version.form.json_schema),
        {},
      );
      expect(invalid.valid).toBe(false);
      expect(
        invalid.issues.some(
          (i) =>
            i.code === 'CONST_MISMATCH' ||
            i.code === 'PATTERN' ||
            i.code === 'ADDITIONAL_PROPERTY' ||
            i.code === 'REQUIRED',
        ),
      ).toBe(true);
    },
  );
});
