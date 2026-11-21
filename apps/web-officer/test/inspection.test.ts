import { describe, expect, it } from 'vitest';
import {
  labCreateBody,
  parseResultCode,
  toInspectionCard,
  type PlatformInspection,
} from '../lib/portal/inspections';
import { deskHomeForRoles, isInspectionRole } from '../lib/portal/desk';

const base: PlatformInspection = {
  inspection_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  application_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workflow_node_id: 'SITE_VISIT',
  inspection_state: 'REQUESTED',
  statutory_effect: false,
  aggregate_version: 1,
  assignment: {
    role_code: 'SAMPLE_LAB_INSPECTION_OFFICER',
    organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
    jurisdiction_id: '0d15ba00-0b01-4000-8000-0d15ba000b01',
  },
  schedule: {},
  created_at: '2026-11-21T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
};

describe('officer inspection desk helpers', () => {
  it('projects REQUESTED card with schedule action and pin label', () => {
    const card = toInspectionCard(base);
    expect(card.can_schedule).toBe(true);
    expect(card.can_start).toBe(true);
    expect(card.can_record_result).toBe(false);
    expect(card.pin_label).toBe('Trade licence site visit');
    expect(card.verification_result).toBeNull();
  });

  it('enables result + complete only in IN_PROGRESS after result recorded', () => {
    const inProgress = toInspectionCard({ ...base, inspection_state: 'IN_PROGRESS' });
    expect(inProgress.can_record_result).toBe(true);
    expect(inProgress.can_complete).toBe(false);
    const withResult = toInspectionCard({
      ...base,
      inspection_state: 'IN_PROGRESS',
      verification_result: 'DEFICIENCY_NOTED',
    });
    expect(withResult.can_complete).toBe(true);
    expect(withResult.verification_label).toBe('Deficiency noted');
  });

  it('builds create body from published pin metadata (no service forks)', () => {
    const body = labCreateBody({
      application_id: base.application_id,
      pin_code: 'TRADE_LICENCE_SITE_VISIT',
    });
    expect(body?.workflow_node_id).toBe('SITE_VISIT');
    expect(body?.assignment['role_code']).toBe('SAMPLE_LAB_INSPECTION_OFFICER');
    expect(body?.assignment).not.toHaveProperty('officer_id');
    expect(labCreateBody({ application_id: base.application_id, pin_code: 'NOPE' })).toBeNull();
  });

  it('accepts only catalogue verification results', () => {
    expect(parseResultCode('DEFICIENCY_NOTED')).toBe('DEFICIENCY_NOTED');
    expect(parseResultCode('APPROVED')).toBeNull();
    expect(parseResultCode('REJECTED')).toBeNull();
  });

  it('routes inspection-only officers to /inspection', () => {
    expect(isInspectionRole('SAMPLE_LAB_INSPECTION_OFFICER')).toBe(true);
    expect(deskHomeForRoles(['SAMPLE_LAB_INSPECTION_OFFICER'])).toBe('/inspection');
    expect(deskHomeForRoles(['SAMPLE_LAB_CASE_OFFICER', 'SAMPLE_LAB_INSPECTION_OFFICER'])).toBe(
      '/applications',
    );
  });
});
