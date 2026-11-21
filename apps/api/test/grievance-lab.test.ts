import { describe, expect, it } from 'vitest';
import {
  LabGrievanceRoutingPort,
  parseGrievanceCatalogue,
  assignmentForLevel,
} from '../src/platform/grievance.js';

describe('SAMPLE_LAB grievance catalogue / routing', () => {
  const catalogue = parseGrievanceCatalogue({
    categories: [
      { code: 'CASE', label: 'Case', description: 'x' },
      { code: 'DOCUMENT', label: 'Document', description: 'y' },
    ],
    escalation: [
      { level: 1, role_code: 'SAMPLE_LAB_HELPDESK_L1', label: 'L1' },
      { level: 2, role_code: 'SAMPLE_LAB_HELPDESK_L2', label: 'L2' },
    ],
    routing: {
      organisation_id: '0d15ba00-0a01-4000-8000-0d15ba000a01',
      jurisdiction_id: '0d15ba00-0j01-4000-8000-0d15ba000j01',
      office_id: null,
      max_escalation_level: 2,
      citizen_may_request_escalation: true,
    },
  });

  it('routes published categories to L1 desk without named officers', async () => {
    const port = new LabGrievanceRoutingPort(catalogue);
    const a = await port.resolve(
      {},
      {
        category_code: 'CASE',
        kind: 'GRIEVANCE',
        organisation_id: null,
        jurisdiction_id: null,
        service_scope_id: null,
      },
    );
    expect(a.role_code).toBe('SAMPLE_LAB_HELPDESK_L1');
    expect(Object.keys(a).sort()).toEqual(
      ['jurisdiction_id', 'office_id', 'organisation_id', 'role_code', 'service_scope_id'].sort(),
    );
  });

  it('refuses categories outside the published catalogue (fail-closed)', async () => {
    const port = new LabGrievanceRoutingPort(catalogue);
    await expect(
      port.resolve(
        {},
        {
          category_code: 'ORDER',
          kind: 'GRIEVANCE',
          organisation_id: null,
          jurisdiction_id: null,
          service_scope_id: null,
        },
      ),
    ).rejects.toThrow(/CATEGORY_NOT_IN_PUBLISHED_CATALOGUE/);
  });

  it('builds escalation assignment for allowed levels only', () => {
    expect(assignmentForLevel(catalogue, 2)?.role_code).toBe('SAMPLE_LAB_HELPDESK_L2');
    expect(assignmentForLevel(catalogue, 3)).toBeNull();
  });
});
