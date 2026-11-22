import { describe, expect, it } from 'vitest';
import {
  buildSampleLabFormData,
  isSampleLabRepresentative,
  labOfferVersion,
  listTemplates,
  SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS,
  templateByCatalogueId,
  usesSampleLabDummyPolicy,
} from '../src/index';

describe('SAMPLE_LAB lab offer + sample form data', () => {
  it('lists Residence plus Certificate/Licence/Permit SAMPLE_LAB lab offers', () => {
    expect(SAMPLE_LAB_REPRESENTATIVE_CATALOGUE_IDS).toHaveLength(13);
    expect(isSampleLabRepresentative('IND-SOC-002')).toBe(true);
    expect(isSampleLabRepresentative('IND-SOC-003')).toBe(true);
    expect(isSampleLabRepresentative('IND-BTP-001')).toBe(true);
    expect(isSampleLabRepresentative('IND-ULB-007')).toBe(true);
    expect(isSampleLabRepresentative('IND-SOC-014')).toBe(false);
  });

  it('labOfferVersion returns PUBLISHED for Residence; DRAFT stubs only in SAMPLE_LAB', () => {
    const residence = templateByCatalogueId('IND-SOC-002');
    const income = templateByCatalogueId('IND-SOC-031');
    expect(residence && labOfferVersion(residence)?.status).toBe('PUBLISHED');
    expect(income && labOfferVersion(income, { environmentLabel: 'PRODUCTION' })).toBeNull();
    expect(income && labOfferVersion(income, { environmentLabel: 'SAMPLE_LAB' })?.status).toBe(
      'DRAFT',
    );
    expect(income && usesSampleLabDummyPolicy(income)).toBe(true);
  });

  it.each(listTemplates().map((t) => [t.catalogue_id, t] as const))(
    '%s sample data is synthetic and covers required keys',
    (_id, template) => {
      const version = template.versions[template.versions.length - 1];
      expect(version, _id).toBeDefined();
      if (!version) return;
      const sample = version.sample_data ?? buildSampleLabFormData(version.form.json_schema);
      const required = version.form.json_schema.required ?? [];
      for (const key of required) {
        expect(sample[key], key).toBeDefined();
      }
      expect(JSON.stringify(sample)).not.toMatch(/[0-9]{12}/);
      const name = sample['applicant_name'] ?? sample['child_name'];
      if (typeof name === 'string') {
        expect(name).toMatch(/^(SAMPLE|Lab)/);
      }
    },
  );
});
