import { describe, expect, it } from 'vitest';
import { sha256Of } from '../../src/domain/canonical.js';
import { parseFormPackage } from '../../src/domain/pack.js';
import { runFormRuntime } from '../../src/domain/runtime.js';

interface CatalogueVersion {
  version: string;
  status: string;
  content_hash: string;
  form: { form_id: string };
  sample_data?: Record<string, unknown>;
}

// The catalogue is bundler-resolved source; a non-literal specifier keeps it out of this program.
const CATALOGUE = '@serviceform/service-templates';
const { listTemplates } = (await import(CATALOGUE)) as {
  listTemplates(): { template_id: string; versions: CatalogueVersion[] }[];
};

// REQ: Studio template catalogue forms are CMP-009 FORM packages (no named-service branching).
const versions = listTemplates().flatMap((t) =>
  t.versions.map((v) => ({ id: `${t.template_id}@${v.version}`, v })),
);

function run(index: number, data: Record<string, unknown>) {
  const v = versions[index]?.v;
  if (!v) throw new Error('missing version');
  const pack = parseFormPackage(v.form, v.form.form_id);
  return runFormRuntime(pack.jsonSchema, pack.uiSchema, data, {});
}

describe('Studio template catalogue against the CMP-009 runtime', () => {
  it.each(versions.map((x, i) => [x.id, i] as const))('%s parses as a FORM package', (_id, i) => {
    const v = versions[i]?.v;
    expect(v && parseFormPackage(v.form, v.form.form_id).formId).toBe(v?.form.form_id);
    expect(v?.content_hash).toBe(sha256Of(v?.form));
    expect(run(i, {}).rendererIds).not.toContain('Ux4gUnsupported');
  });

  it('the published Residence sample data is VALID once declared, and patterns are enforced', () => {
    const i = versions.findIndex((x) => x.v.status === 'PUBLISHED');
    const sample: Record<string, unknown> = {
      ...(versions[i]?.v.sample_data ?? {}),
      declaration_accepted: true,
    };
    expect(run(i, sample).issues).toEqual([]);
    const bad = run(i, {
      ...sample,
      applicant_mobile: '12345',
      residence_address: { ...(sample['residence_address'] as object), pincode: '75100' },
      declaration_accepted: false,
    });
    expect(bad.issues).toEqual(
      expect.arrayContaining([
        { code: 'PATTERN', pointer: '/applicant_mobile' },
        { code: 'PATTERN', pointer: '/residence_address/pincode' },
        { code: 'CONST_MISMATCH', pointer: '/declaration_accepted' },
      ]),
    );
  });

  it('email updates show the email control and make it required', () => {
    const i = versions.findIndex((x) => x.v.status === 'PUBLISHED');
    const off = run(i, { notify_by_email: false });
    expect(off.visibleScopes).not.toContain('#/properties/applicant_email');
    const on = run(i, { notify_by_email: true });
    expect(on.visibleScopes).toContain('#/properties/applicant_email');
    expect(on.requiredFields).toContain('applicant_email');
    expect(on.issues).toContainEqual({ code: 'REQUIRED', pointer: '/applicant_email' });
  });

  it('marks nested address parts required only where the schema path requires them', () => {
    const i = versions.findIndex((x) => x.v.status === 'PUBLISHED');
    const out = run(i, {});
    expect(out.requiredFields).toEqual(expect.arrayContaining(['pincode', 'district']));
    expect(out.requiredFields).not.toContain('post_office');
    expect(out.requiredFields).not.toContain('applicant_mobile');
  });
});
