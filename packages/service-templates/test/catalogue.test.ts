import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_OUTPUT_TYPE,
  CERTIFICATE_UNIVERSE_FILTER,
  catalogueIdForFormVersion,
  certificateUniverseIds,
  diffVersions,
  formFields,
  formPin,
  HANDCRAFTED_CERTIFICATE_IDS,
  listTemplates,
  policyInputsPending,
  publishedVersion,
  sampleLabDummyAllowed,
  assertSampleLabDummyAllowed,
  stepLabels,
  templateByCatalogueId,
  templateById,
  TEMPLATE_REGISTRY_SOURCE,
  usesSampleLabDummyPolicy,
  type UiElement,
} from '../src/index';
import { assertVersionIntegrity, formContentHash } from '../src/integrity';
import { resolveSampleLabOwnerConfig } from '../src/sample-lab-dummy-resolve';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const registry = JSON.parse(readFileSync(join(ROOT, TEMPLATE_REGISTRY_SOURCE.path), 'utf8')) as {
  catalogue_version: string;
  canonical_services: Record<string, string>[];
};
const packManifest = JSON.parse(
  readFileSync(join(ROOT, 'templates/certificate-packs/manifest.json'), 'utf8'),
) as {
  generated_pack_count: number;
  total_manifest_entries: number;
  packs: { catalogue_id: string; authoring_path: string; generator: string }[];
};
const bindings = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/lab/platform/published-bindings.json'), 'utf8'),
) as { bindings: { catalogue_id: string; pins: { form_version_id: string } }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const templates = listTemplates();
const registryCertificates = registry.canonical_services.filter(
  (e) => e['Service / Output Type'] === CERTIFICATE_OUTPUT_TYPE,
);

function scopes(node: UiElement): string[] {
  if (node.type === 'Control') return [node.scope];
  return node.elements.flatMap(scopes);
}

const scopeToPointer = (scope: string) =>
  scope.replace('#/properties/', '/').replaceAll('/properties/', '/');

// REQ: catalogue grounded in docs/catalogue; published metadata immutable (Constitution).
describe('template catalogue (SAMPLE_LAB)', () => {
  it('covers the Certificate universe plus Birth Registration stub', () => {
    expect(CERTIFICATE_UNIVERSE_FILTER.equals).toBe('Certificate');
    expect(certificateUniverseIds()).toHaveLength(registryCertificates.length);
    expect(templates.filter((t) => t.maturity === 'SAMPLE_LAB_PUBLISHED')).toHaveLength(1);
    // 158 Certificate templates + Birth (IND-CIV-001 Registration) hand-crafted stub
    expect(templates).toHaveLength(registryCertificates.length + 1);
    expect(templates.filter((t) => t.maturity === 'SAMPLE_LAB_STUB')).toHaveLength(
      templates.length - 1,
    );
    expect(new Set(templates.map((t) => t.catalogue_id)).size).toBe(templates.length);
    for (const id of certificateUniverseIds()) {
      expect(templateByCatalogueId(id), id).toBeDefined();
    }
    expect(templateByCatalogueId('IND-CIV-001')?.output_type).toBe('Registration');
    expect(templateByCatalogueId('IND-SOC-002')?.name).toBe('Residence Certificate');
    expect(templateById('ind-soc-031.income-certificate')?.catalogue_id).toBe('IND-SOC-031');
    expect(HANDCRAFTED_CERTIFICATE_IDS.has('IND-SOC-002')).toBe(true);
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

  it('stubs use SAMPLE_LAB DUMMY policy and have no PUBLISHED version', () => {
    for (const t of templates.filter((x) => x.maturity === 'SAMPLE_LAB_STUB')) {
      expect(publishedVersion(t)).toBeNull();
      expect(t.versions.every((v) => v.status === 'DRAFT')).toBe(true);
      expect(usesSampleLabDummyPolicy(t), t.catalogue_id).toBe(true);
      expect(policyInputsPending(t), t.catalogue_id).toBe(false);
      expect(t.policy.fee).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
      expect(t.indicative_checks).toEqual([]);
    }
    // Configurable packs: every stub points at an authoring shell; apply stays placement-gated.
    expect(templateByCatalogueId('IND-SOC-031')?.authoring_path).toBe(
      'templates/income-certificate/',
    );
    expect(templateByCatalogueId('IND-SOC-002')?.authoring_path).toBe(
      'templates/residence-certificate/',
    );
    expect(templateByCatalogueId('IND-SOC-001')?.authoring_path).toBe(
      'templates/certificate-packs/ind-soc-001/',
    );
    expect(templateByCatalogueId('IND-CIV-001')?.authoring_path).toBe(
      'templates/certificate-packs/ind-civ-001/',
    );
    expect(templateByCatalogueId('IND-AGR-002')?.authoring_path).toBe(
      'templates/certificate-packs/ind-agr-002/',
    );
    for (const t of templates.filter((x) => x.maturity === 'SAMPLE_LAB_STUB')) {
      expect(t.authoring_path, t.catalogue_id).toMatch(/^templates\//);
    }
  });

  it('configurable pack factory covers stubs with on-disk SAMPLE_LAB DUMMY artefacts', () => {
    expect(packManifest.generated_pack_count).toBe(157);
    expect(packManifest.total_manifest_entries).toBe(159);
    expect(existsSync(join(ROOT, 'templates/certificate-packs/owner-config.schema.json'))).toBe(
      true,
    );
    expect(
      existsSync(join(ROOT, 'templates/certificate-packs/sample-lab-dummy/defaults.json')),
    ).toBe(true);
    expect(
      existsSync(
        join(ROOT, 'templates/certificate-packs/sample-lab-dummy/tenant-overlay.schema.json'),
      ),
    ).toBe(true);
    expect(existsSync(join(ROOT, 'templates/certificate-pack-skeleton/service.yaml.tmpl'))).toBe(
      true,
    );
    for (const t of templates) {
      const path = t.authoring_path;
      expect(path, t.catalogue_id).toBeTruthy();
      if (!path) continue;
      const serviceYaml = join(ROOT, path, 'service.yaml');
      expect(existsSync(serviceYaml), serviceYaml).toBe(true);
      if (t.maturity === 'SAMPLE_LAB_STUB') {
        const fee = readFileSync(join(ROOT, path, 'fee-policy.yaml'), 'utf8');
        const sla = readFileSync(join(ROOT, path, 'sla-policy.yaml'), 'utf8');
        const evidence = readFileSync(join(ROOT, path, 'evidence-policy.yaml'), 'utf8');
        expect(fee).toMatch(/SAMPLE_LAB_DUMMY/);
        expect(sla).toMatch(/SAMPLE_LAB_DUMMY/);
        expect(evidence).toMatch(/SAMPLE_LAB_DUMMY/);
        expect(existsSync(join(ROOT, path, 'form.schema.json'))).toBe(true);
        expect(existsSync(join(ROOT, path, 'owner-config.json'))).toBe(true);
      }
    }
    const byId = new Map(packManifest.packs.map((p) => [p.catalogue_id, p]));
    expect(byId.get('IND-SOC-002')?.generator).toBe('handcrafted');
    expect(byId.get('IND-SOC-031')?.generator).toBe('handcrafted');
    expect(byId.get('IND-AGR-002')?.authoring_path).toBe(
      'templates/certificate-packs/ind-agr-002/',
    );
  });

  it('resolves SAMPLE_LAB DUMMY owner-config with tenant overlay; refuses outside lab', () => {
    expect(sampleLabDummyAllowed('SAMPLE_LAB')).toBe(true);
    expect(sampleLabDummyAllowed('PRODUCTION')).toBe(false);
    expect(() => assertSampleLabDummyAllowed('PRODUCTION')).toThrow(/fail-closed/);
    const base = resolveSampleLabOwnerConfig('IND-SOC-003');
    expect(base['policy_kind']).toBe('SAMPLE_LAB_DUMMY');
    expect((base['fee'] as { amount_minor_units: number }).amount_minor_units).toBe(999);
    expect((base['credential'] as { credential_template_id: string }).credential_template_id).toBe(
      'SAMPLE_LAB_DUMMY_IND_SOC_003_V1',
    );
    const overlay = resolveSampleLabOwnerConfig('IND-SOC-003', {
      tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
      catalogue_id: 'IND-SOC-003',
      environment_label: 'SAMPLE_LAB',
      fee: { currency: 'INR', amount_minor_units: 500 },
    });
    expect((overlay['fee'] as { amount_minor_units: number }).amount_minor_units).toBe(500);
    expect(overlay['tenant_id']).toBe('0d15ba00-0001-4000-8000-0d15ba0000d1');
    const income = resolveSampleLabOwnerConfig('IND-SOC-031');
    expect(
      (income['credential'] as { credential_template_id: string }).credential_template_id,
    ).toBe('SAMPLE_LAB_DUMMY_IND_SOC_031_V1');
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

  it('maps form version ids to catalogue ids; SAMPLE_LAB DUMMY clears policyInputsPending', () => {
    expect(catalogueIdForFormVersion('0d15ba00-0010-4000-8000-0d15ba000010')).toBe('IND-SOC-002');
    expect(catalogueIdForFormVersion('7e3a0031-0001-4000-8000-00000000031a')).toBe('IND-SOC-031');
    expect(catalogueIdForFormVersion('00000000-0000-4000-8000-000000000000')).toBeNull();
    const income = templateByCatalogueId('IND-SOC-031');
    const residence = templateByCatalogueId('IND-SOC-002');
    expect(income && policyInputsPending(income)).toBe(false);
    expect(income && usesSampleLabDummyPolicy(income)).toBe(true);
    expect(residence && policyInputsPending(residence)).toBe(false);
    expect(residence && usesSampleLabDummyPolicy(residence)).toBe(false);
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
