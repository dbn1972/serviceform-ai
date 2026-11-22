import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { policyInputsPending, templateByCatalogueId, usesSampleLabDummyPolicy } from '../src/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const M11 = join(ROOT, 'fixtures/m11/ind-soc-031');

// REQ: SF-61 M11 Income path/fixtures polish — dry-run Studio→TSB; DRAFT / DUMMY; SF-33 gated.
describe('M11 Income dry-run fixtures (SF-61)', () => {
  it('keeps IND-SOC-031 DRAFT stub with SAMPLE_LAB DUMMY (not PUBLISHED)', () => {
    const t = templateByCatalogueId('IND-SOC-031');
    expect(t?.maturity).toBe('SAMPLE_LAB_STUB');
    expect(t?.versions.every((v) => v.status === 'DRAFT')).toBe(true);
    expect(t && usesSampleLabDummyPolicy(t)).toBe(true);
    expect(t && policyInputsPending(t)).toBe(false);
    expect(t?.authoring_path).toBe('templates/income-certificate/');
  });

  it('ships dry-run path fixtures without inventing statute', () => {
    for (const name of [
      'README.md',
      'POLICY_INPUT_REQUIRED.md',
      'path-checklist.md',
      'tsb-dry-run-fixture.json',
      'maker-checker-dry-run.yaml',
      'tenant-overlay.sample-lab-dummy.yaml',
    ]) {
      expect(existsSync(join(M11, name)), name).toBe(true);
    }
    expect(
      existsSync(
        join(ROOT, 'fixtures/catalogue/certificate-packs/ind-soc-031.SAMPLE_LAB_DUMMY.md'),
      ),
    ).toBe(true);

    const tsb = JSON.parse(readFileSync(join(M11, 'tsb-dry-run-fixture.json'), 'utf8')) as {
      tsb: { version_status: string; publication_state: string; catalogue_id: string };
      _non_claims: { certified: boolean; g6: boolean; citizen_offerable_published: boolean };
      publish_gate_requirements: { sf33_owner_policy_inputs_supplied: boolean };
    };
    expect(tsb.tsb.catalogue_id).toBe('IND-SOC-031');
    expect(tsb.tsb.version_status).toBe('DRAFT');
    expect(tsb.tsb.publication_state).toMatch(/DRY_RUN/);
    expect(tsb._non_claims.certified).toBe(false);
    expect(tsb._non_claims.g6).toBe(false);
    expect(tsb._non_claims.citizen_offerable_published).toBe(false);
    expect(tsb.publish_gate_requirements.sf33_owner_policy_inputs_supplied).toBe(false);

    const policy = readFileSync(join(M11, 'POLICY_INPUT_REQUIRED.md'), 'utf8');
    expect(policy).toMatch(/SF-33/);
    expect(policy).toMatch(/SAMPLE_LAB DUMMY/);
    expect(policy).not.toMatch(/CERTIFIED=true|G6=true/);
  });
});
