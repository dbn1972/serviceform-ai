import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateByCatalogueId } from '@serviceform/service-templates';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogueEntries, formOutline, isOffered, policyText } from '../lib/catalogue';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// REQ: citizen catalogue = template metadata + portal placement (only bound, PUBLISHED services).
describe('citizen service catalogue', () => {
  beforeAll(() => {
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });

  it('offers SAMPLE_LAB placement bindings (Residence PUBLISHED + lab-offer stubs)', () => {
    const entries = catalogueEntries();
    expect(entries.find((e) => e.catalogue_id === 'IND-SOC-002')).toMatchObject({
      offered: true,
      fee: '₹0',
    });
    expect(entries.filter((e) => e.offered)).toHaveLength(6);
    expect(entries.some((e) => e.catalogue_id === 'IND-SOC-031' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-CIV-001' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-SOC-003' && !e.offered)).toBe(true);
    const income = templateByCatalogueId('IND-SOC-031');
    expect(income && isOffered(income)).toBe(true);
  });

  it('shows SAMPLE_LAB sample parameter labels for stubs (configurable, not locked statute)', () => {
    expect(policyText('POLICY_INPUT_REQUIRED')).toBe('To be published by the department');
    const income = catalogueEntries().find((e) => e.catalogue_id === 'IND-SOC-031');
    expect(income?.fee).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
    expect(income?.service_time).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
    expect(income?.eligibility).toMatch(/SAMPLE_LAB (DUMMY|sample)/);
  });

  it('outlines the steps and fields a citizen will be asked for', () => {
    const t = templateByCatalogueId('IND-CIV-001');
    const outline = t ? formOutline(t) : null;
    expect(outline?.steps).toEqual(['Event', 'Parents', 'Preview']);
    expect(outline?.fields.map((f) => f.pointer)).toContain('/event_place');
    expect(outline?.fields.map((f) => f.pointer)).not.toContain('/declaration_accepted');
  });
});
