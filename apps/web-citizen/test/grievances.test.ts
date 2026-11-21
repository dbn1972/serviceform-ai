import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  parseCategory,
  simulatedBodyRef,
  toPortalGrievance,
  type PlatformGrievance,
} from '../lib/portal/grievances';

const base: PlatformGrievance = {
  grievance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'GRIEVANCE',
  status: 'OPEN',
  aggregate_version: 4,
  reference_code: 'GF-AAAAAAAAAAAA',
  category_code: 'CASE',
  service_id: null,
  application_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  organisation_id: null,
  jurisdiction_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('citizen grievance portal helpers', () => {
  it('maps published categories and portal view', () => {
    expect(parseCategory('CASE')).toBe('CASE');
    expect(parseCategory('ORDER')).toBeNull();
    expect(categoryLabel('PAYMENT')).toMatch(/payment/i);
    const view = toPortalGrievance(base);
    expect(view.can_respond).toBe(true);
    expect(view.can_request_escalation).toBe(true);
    expect(view.status_label).toMatch(/helpdesk/i);
  });

  it('builds opaque SIMULATED body refs without free-form PII columns', () => {
    const ref = simulatedBodyRef('please look again');
    expect(ref.startsWith('lab-body:')).toBe(true);
    expect(ref.length).toBeGreaterThanOrEqual(8);
  });
});
