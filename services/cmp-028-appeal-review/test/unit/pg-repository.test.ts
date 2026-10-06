import { describe, expect, it } from 'vitest';
import { PgAppealRepository, toAppeal } from '../../src/repo/pg.js';

describe('pg mappers', () => {
  it('maps a row including empty evidence array', () => {
    const row = toAppeal({
      tenant_id: '00000000-0000-4000-8000-000000000001',
      appeal_id: '00000000-0000-4000-8000-000000000099',
      original_application_id: '00000000-0000-4000-8000-000000000051',
      original_case_id: null,
      original_decision_id: null,
      cell_id: 'cell-01',
      appeal_state: 'FILED',
      grounds_code: 'PROCEDURAL_ERROR',
      evidence_refs: [],
      admissibility_code: 'PENDING',
      admissibility_reason_code: null,
      role_code: 'APPELLATE_AUTHORITY',
      organisation_id: '00000000-0000-4000-8000-000000000011',
      office_id: null,
      jurisdiction_id: '00000000-0000-4000-8000-000000000031',
      service_scope_id: null,
      workflow_instance_id: null,
      workflow_version_id: null,
      hearing_ref: null,
      review_ref: null,
      decision_ref: null,
      original_case_command_ref: null,
      created_by: '00000000-0000-4000-8000-000000000101',
      correlation_id: '00000000-0000-4000-8000-000000000777',
      aggregate_version: 1,
      created_at: new Date('2026-10-06T00:00:00Z'),
      updated_at: new Date('2026-10-06T00:00:00Z'),
    });
    expect(row.evidence_refs).toEqual([]);
    expect(row.authority.office_id).toBeNull();
    expect(PgAppealRepository.name).toBe('PgAppealRepository');
  });
});
