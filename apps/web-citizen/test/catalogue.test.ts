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

  it('offers only services the placement binds with a PUBLISHED version', () => {
    const entries = catalogueEntries();
    expect(entries[0]).toMatchObject({ catalogue_id: 'IND-SOC-002', offered: true, fee: '₹0' });
    expect(entries.filter((e) => e.offered)).toHaveLength(1);
    expect(entries.filter((e) => !e.offered).map((e) => e.catalogue_id)).toEqual([
      'IND-CIV-001',
      'IND-SOC-001',
      'IND-SOC-031',
    ]);
    const stub = templateByCatalogueId('IND-SOC-031');
    expect(stub && isOffered(stub)).toBe(false);
  });

  it('never shows invented policy for stubs', () => {
    expect(policyText('POLICY_INPUT_REQUIRED')).toBe('To be published by the department');
    const income = catalogueEntries().find((e) => e.catalogue_id === 'IND-SOC-031');
    expect([income?.fee, income?.service_time, income?.eligibility]).toEqual(
      Array(3).fill('To be published by the department'),
    );
  });

  it('outlines the steps and fields a citizen will be asked for', () => {
    const t = templateByCatalogueId('IND-CIV-001');
    const outline = t ? formOutline(t) : null;
    expect(outline?.steps).toEqual(['Event', 'Parents', 'Preview']);
    expect(outline?.fields.map((f) => f.pointer)).toContain('/event_place');
    expect(outline?.fields.map((f) => f.pointer)).not.toContain('/declaration_accepted');
  });
});
