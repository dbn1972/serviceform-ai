import { describe, expect, it } from 'vitest';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '@serviceform/contracts';
import { T1, TRACE, U1 } from './helpers/fakes.js';

describe('SF-CON-AUTHZ-DECISION conformance', () => {
  it('accepts a valid input and output', () => {
    const input: AuthzDecisionInput = {
      subject: {
        user_id: U1,
        actor_type: 'OFFICER',
        tenant_id: T1,
        roles: ['ROLE_A'],
        jurisdiction_ids: ['55555555-5555-4555-8555-555555555555'],
      },
      resource: {
        resource_type: 'ExampleAggregate',
        tenant_id: T1,
        classification: 'TENANT_SCOPED',
      },
      action: 'VIEW',
      environment: { request_time: '2026-06-01T00:00:00Z', trace_id: TRACE },
    };
    expect(validate('authz-decision-input', input).valid).toBe(true);
    const out: AuthzDecisionOutput = {
      allow: false,
      reason_code: 'DEFAULT_DENY',
      policy_revision: 'w1',
      decision_id: 'e28f6c0d-39f5-4b7c-8ae2-15d0b1f39e6e',
    };
    expect(validate('authz-decision-output', out).valid).toBe(true);
  });
});
