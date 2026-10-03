import { describe, expect, it } from 'vitest';
import { sanitizeDecisionLog } from '../src/pep/decision-log.js';

describe('decision log allowlist (002-35)', () => {
  it('drops forbidden fields and keeps allowlist', () => {
    const out = sanitizeDecisionLog({
      decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
      trace_id: '0af7651916cd43dd8448eb211c80319c',
      correlation_id: '6a0e8c5f-b17d-4eaf-826a-9d5e3f7b1c86',
      policy_revision: 'w1',
      path: 'sf/authz/decision',
      allow: false,
      reason_code: 'ROLE_NOT_PERMITTED',
      latency_ms: 3,
      action: 'VIEW',
      resource_type: 'ExampleAggregate',
      resource_tenant_id: '11111111-1111-4111-8111-111111111111',
      subject_actor_type: 'OFFICER',
      roles: ['ROLE_A'],
      delegation_present: false,
    });
    expect(out.user_id).toBeUndefined();
    expect(out.justification).toBeUndefined();
    expect(out.reason_code).toBe('ROLE_NOT_PERMITTED');
    expect(JSON.stringify(out)).not.toContain('justification');
  });
});
