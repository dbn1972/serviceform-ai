import { describe, expect, it } from 'vitest';
import {
  assignmentFromCatalogue,
  parseInspectionCatalogue,
  pinByCode,
} from '../src/platform/inspection.js';

describe('SAMPLE_LAB inspection catalogue', () => {
  const catalogue = parseInspectionCatalogue({
    assignment_defaults: {
      role_code: 'SAMPLE_LAB_INSPECTION_OFFICER',
      organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
      jurisdiction_id: '0d15ba00-0b01-4000-8000-0d15ba000b01',
      office_id: null,
    },
    verification_results: [
      { code: 'VERIFIED', label: 'Verified', description: 'ok' },
      { code: 'DEFICIENCY_NOTED', label: 'Deficiency noted', description: 'follow-up' },
    ],
    pins: [
      {
        pin_code: 'TRADE_LICENCE_SITE_VISIT',
        catalogue_id: 'IND-BTP-001',
        label: 'Trade licence site visit',
        description: 'lab',
        workflow_node_id: 'SITE_VISIT',
        checklist_items: [{ code: 'SITE_ACCESS', label: 'Access', required: true }],
      },
      {
        pin_code: 'BAD_NODE',
        catalogue_id: null,
        label: 'bad',
        description: 'rejected lowercase node',
        workflow_node_id: 'site-visit',
        checklist_items: [],
      },
    ],
  });

  it('keeps valid pins and drops invalid workflow_node_id (fail-closed metadata)', () => {
    expect(catalogue.pins.map((p) => p.pin_code)).toEqual(['TRADE_LICENCE_SITE_VISIT']);
    expect(pinByCode(catalogue, 'TRADE_LICENCE_SITE_VISIT')?.workflow_node_id).toBe('SITE_VISIT');
    expect(pinByCode(catalogue, 'BAD_NODE')).toBeNull();
  });

  it('builds assignment from catalogue without named officers', () => {
    const a = assignmentFromCatalogue(catalogue);
    expect(a.role_code).toBe('SAMPLE_LAB_INSPECTION_OFFICER');
    expect(Object.keys(a).sort()).toEqual(
      ['jurisdiction_id', 'office_id', 'organisation_id', 'role_code', 'service_scope_id'].sort(),
    );
    expect(a.office_id).toBeNull();
    expect(a.service_scope_id).toBeNull();
  });

  it('exposes DEFICIENCY_NOTED as a non-statutory verification result', () => {
    expect(catalogue.verification_results.some((r) => r.code === 'DEFICIENCY_NOTED')).toBe(true);
    expect(catalogue.verification_results.every((r) => r.code !== 'APPROVED')).toBe(true);
  });
});
