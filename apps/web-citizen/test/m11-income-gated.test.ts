import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyInputsPending, templateByCatalogueId } from '@serviceform/service-templates';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogueEntries, isOffered } from '../lib/catalogue';
import { offeredForm } from '../lib/portal/forms';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// REQ M11: Income Certificate stays gated until owner policy; no invented statute.
describe('M11 Income Certificate (IND-SOC-031) stays gated', () => {
  beforeAll(() => {
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });

  it('keeps POLICY_INPUT_REQUIRED and SAMPLE_LAB_STUB with Studio authoring shell', () => {
    const t = templateByCatalogueId('IND-SOC-031');
    expect(t?.maturity).toBe('SAMPLE_LAB_STUB');
    expect(t && policyInputsPending(t)).toBe(true);
    expect(t?.authoring_path).toBe('templates/income-certificate/');
    expect(t?.indicative_checks).toEqual([]);
  });

  it('is not offered and has no applyable form on the SAMPLE_LAB placement', () => {
    const t = templateByCatalogueId('IND-SOC-031');
    expect(t && isOffered(t)).toBe(false);
    expect(offeredForm('IND-SOC-031')).toBeNull();
    const entry = catalogueEntries().find((e) => e.catalogue_id === 'IND-SOC-031');
    expect(entry?.offered).toBe(false);
    expect([entry?.fee, entry?.service_time, entry?.eligibility]).toEqual(
      Array(3).fill('To be published by the department'),
    );
  });

  it('does not place IND-SOC-031 in citizen offerings', () => {
    expect(
      catalogueEntries()
        .filter((e) => e.offered)
        .map((e) => e.catalogue_id),
    ).toEqual(['IND-SOC-002']);
  });
});
