import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateByCatalogueId } from '@serviceform/service-templates';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  catalogueEntries,
  citizenPolicyText,
  formOutline,
  isOffered,
  isSampleLabPolicy,
  policyText,
} from '../lib/catalogue';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// REQ: citizen catalogue = template metadata + portal placement (only bound, PUBLISHED services).
describe('citizen service catalogue', () => {
  beforeAll(() => {
    process.env['SF_PORTAL_PLACEMENT_FILE'] = join(
      ROOT,
      'fixtures/lab/platform/placement.citizen.json',
    );
  });

  it('offers SAMPLE_LAB placement bindings (Residence PUBLISHED + Cert/Lic/Perm lab-offer stubs)', () => {
    const entries = catalogueEntries();
    expect(entries.find((e) => e.catalogue_id === 'IND-SOC-002')).toMatchObject({
      offered: true,
      fee: '₹0',
    });
    expect(entries.filter((e) => e.offered)).toHaveLength(13);
    expect(entries.some((e) => e.catalogue_id === 'IND-SOC-031' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-CIV-001' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-SOC-003' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-BTP-001' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-ULB-007' && e.offered)).toBe(true);
    expect(entries.some((e) => e.catalogue_id === 'IND-SOC-014' && !e.offered)).toBe(true);
    const income = templateByCatalogueId('IND-SOC-031');
    expect(income && isOffered(income)).toBe(true);
  });

  it('shortens SAMPLE_LAB sample policy dumps for citizen cards (scannable fee/time)', () => {
    expect(policyText('POLICY_INPUT_REQUIRED')).toBe('To be published by the department');
    expect(citizenPolicyText('SAMPLE_LAB sample · ₹9.99 (configurable per tenant)')).toBe('₹9.99');
    expect(citizenPolicyText('SAMPLE_LAB sample · 15 working days (configurable per tenant)')).toBe(
      '15 working days',
    );
    expect(isSampleLabPolicy('SAMPLE_LAB sample · ₹9.99 (configurable per tenant)')).toBe(true);
    const income = catalogueEntries().find((e) => e.catalogue_id === 'IND-SOC-031');
    expect(income?.fee).toBe('₹9.99');
    expect(income?.service_time).toBe('15 working days');
    expect(income?.eligibility).toBe('Sample lab parameters');
    expect(income?.fee).not.toMatch(/SAMPLE_LAB|configurable/i);
  });

  it('outlines the steps and fields a citizen will be asked for', () => {
    const t = templateByCatalogueId('IND-CIV-001');
    const outline = t ? formOutline(t) : null;
    expect(outline?.steps).toEqual(['Event', 'Parents', 'Preview']);
    expect(outline?.fields.map((f) => f.pointer)).toContain('/event_place');
    expect(outline?.fields.map((f) => f.pointer)).not.toContain('/declaration_accepted');
  });
});
