import { describe, expect, it } from 'vitest';
import { validate } from '@serviceform/contracts';
import { envelope } from '../src/events/envelopes.js';
import type { RequestContext } from '@serviceform/contracts';

const T1 = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx: RequestContext = {
  tenant_id: T1,
  cell_id: 'cell-01',
  actor: { type: 'OFFICER', id: U1 },
  roles: ['ROLE_A'],
  jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
  auth_assurance: 'MFA',
  correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
  trace_id: '0af7651916cd43dd8448eb211c80319c',
};

describe('event envelopes (D14)', () => {
  it('SecurityPolicyPublished is platform (null tenant)', () => {
    const ev = envelope(
      { ...ctx, tenant_id: null },
      {
        event_type: 'SecurityPolicyPublished',
        aggregate_type: 'SecurityPolicy',
        aggregate_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
        aggregate_version: 1,
        tenant_id: null,
        data: {
          bundle_name: 'sf',
          revision: 'w1',
          content_sha256: 'a'.repeat(64),
          activated_at: '2026-10-03T09:00:00Z',
        },
      },
    );
    expect(validate('event-envelope', ev).valid).toBe(true);
    expect(ev.tenant_id).toBeNull();
  });

  it('SecurityIncidentDetected is tenant-scoped', () => {
    const ev = envelope(ctx, {
      event_type: 'SecurityIncidentDetected',
      aggregate_type: 'SecurityIncident',
      aggregate_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
      aggregate_version: 1,
      tenant_id: T1,
      data: { incident_code: 'FORGED_HEADER', reason_code: 'TENANT_MISMATCH' },
    });
    expect(validate('event-envelope', ev).valid).toBe(true);
    expect(JSON.stringify(ev.data)).not.toContain('x-tenant-id');
  });
});
