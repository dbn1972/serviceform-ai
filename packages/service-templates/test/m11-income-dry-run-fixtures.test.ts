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
      'SF33_PUBLISH_BLOCKER.md',
      'sf33-publish-gate.json',
      'PLATFORM_REUSE_GAP_LIST.md',
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

  // REQ: P8-6 / D4 Golden-2 — SF-33 is the only PUBLISH blocker; no statute invented.
  it('declares SF-33 as the only statutory PUBLISH blocker (P8-6)', () => {
    const gate = JSON.parse(readFileSync(join(M11, 'sf33-publish-gate.json'), 'utf8')) as {
      catalogue_id: string;
      version_status: string;
      maturity: string;
      statutory_publish: string;
      publish_blocker: string;
      statute_invented: boolean;
      income_marked_published: boolean;
      certified: boolean;
      g6: boolean;
      self_certified: boolean;
      digilocker_real_out_of_scope: boolean;
    };
    expect(gate.catalogue_id).toBe('IND-SOC-031');
    expect(gate.version_status).toBe('DRAFT');
    expect(gate.maturity).toBe('SAMPLE_LAB_STUB');
    expect(gate.statutory_publish).toBe('BLOCKED');
    expect(gate.publish_blocker).toBe('SF-33');
    expect(gate.statute_invented).toBe(false);
    expect(gate.income_marked_published).toBe(false);
    expect(gate.certified).toBe(false);
    expect(gate.g6).toBe(false);
    expect(gate.self_certified).toBe(false);
    expect(gate.digilocker_real_out_of_scope).toBe(true);

    const blocker = readFileSync(join(M11, 'SF33_PUBLISH_BLOCKER.md'), 'utf8');
    expect(blocker).toMatch(/SF-33 blocks PUBLISH/);
    expect(blocker).toMatch(/BLOCKED — owner SF-33/);
    expect(blocker).not.toMatch(/CERTIFIED=true|G6=true|PUBLISHED statutory/);

    const gaps = readFileSync(join(M11, 'PLATFORM_REUSE_GAP_LIST.md'), 'utf8');
    expect(gaps).toMatch(/No new `services\/\*\*` Income Certificate backend/);
    expect(gaps).toMatch(/sole blocker to statutory \*\*PUBLISH\*\* is owner \*\*SF-33\*\*/);
  });
});
