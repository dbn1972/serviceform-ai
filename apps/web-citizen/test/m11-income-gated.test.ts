import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  policyInputsPending,
  templateByCatalogueId,
  usesSampleLabDummyPolicy,
} from '@serviceform/service-templates';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogueEntries, isOffered } from '../lib/catalogue';
import { offeredForm } from '../lib/portal/forms';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// REQ M11: Income remains SAMPLE_LAB_STUB (no invented statute). SAMPLE_LAB placement may
// lab-offer the DRAFT form with SAMPLE_LAB DUMMY params (fail-closed outside SAMPLE_LAB).
describe('M11 Income Certificate (IND-SOC-031) SAMPLE_LAB lab-offer', () => {
  beforeAll(() => {
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });

  it('uses SAMPLE_LAB DUMMY policy with Studio authoring shell; policyInputsPending cleared', () => {
    const t = templateByCatalogueId('IND-SOC-031');
    expect(t?.maturity).toBe('SAMPLE_LAB_STUB');
    expect(t && usesSampleLabDummyPolicy(t)).toBe(true);
    expect(t && policyInputsPending(t)).toBe(false);
    expect(t?.authoring_path).toBe('templates/income-certificate/');
    expect(t?.indicative_checks).toEqual([]);
  });

  it('is lab-offered on the SAMPLE_LAB placement (DRAFT pin, not CERTIFIED)', () => {
    const t = templateByCatalogueId('IND-SOC-031');
    expect(t && isOffered(t)).toBe(true);
    const offered = offeredForm('IND-SOC-031');
    expect(offered?.version.status).toBe('DRAFT');
    expect(offered?.version.version_id).toBe('7e3a0031-0001-4000-8000-00000000031a');
    const entry = catalogueEntries().find((e) => e.catalogue_id === 'IND-SOC-031');
    expect(entry?.offered).toBe(true);
    expect(entry?.fee).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
    expect(entry?.service_time).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
    expect(entry?.eligibility).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
  });

  it('keeps Income DUMMY-labeled among expanded lab offers; non-offers stay gated', () => {
    const offered = catalogueEntries()
      .filter((e) => e.offered)
      .map((e) => e.catalogue_id)
      .sort();
    expect(offered).toContain('IND-SOC-002');
    expect(offered).toContain('IND-SOC-031');
    expect(offered).toContain('IND-SOC-003');
    expect(offered).toContain('IND-BTP-001');
    expect(offered).not.toContain('IND-SOC-014');
    expect(offered).toHaveLength(13);
  });
});
