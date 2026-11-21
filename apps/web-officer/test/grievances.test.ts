import { describe, expect, it } from 'vitest';
import { labAssignment, toHelpdeskTicket, type PlatformGrievance } from '../lib/portal/grievances';

const base: PlatformGrievance = {
  grievance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'GRIEVANCE',
  status: 'ROUTED',
  aggregate_version: 3,
  reference_code: 'GF-AAAAAAAAAAAA',
  category_code: 'DOCUMENT',
  service_id: null,
  application_id: null,
  organisation_id: null,
  jurisdiction_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('officer helpdesk portal helpers', () => {
  it('exposes assign/route/escalate flags from status + metadata', () => {
    const routed = toHelpdeskTicket(base);
    expect(routed.can_assign).toBe(true);
    expect(routed.can_route).toBe(false);
    const open = toHelpdeskTicket({ ...base, status: 'OPEN' }, 'SAMPLE_LAB_HELPDESK_L1');
    expect(open.can_escalate).toBe(true);
    expect(open.next_escalation_level).toBe(2);
    const top = toHelpdeskTicket({ ...base, status: 'OPEN' }, 'SAMPLE_LAB_HELPDESK_L3');
    expect(top.can_escalate).toBe(false);
  });

  it('builds role-only assignment from published ladder', () => {
    const a = labAssignment(2);
    expect(a?.role_code).toBe('SAMPLE_LAB_HELPDESK_L2');
    expect(a && 'officer_id' in a).toBe(false);
    expect(labAssignment(9)).toBeNull();
  });
});
