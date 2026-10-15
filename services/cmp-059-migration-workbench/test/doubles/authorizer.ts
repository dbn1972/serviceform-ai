import type { AuthzDecisionInput, AuthzDecisionOutput } from '@serviceform/contracts';
import type { AuthorizationPort } from '../../src/authz.js';

export class AllowAuthorizer implements AuthorizationPort {
  async decide(_input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    return {
      allow: true,
      reason_code: 'TEST_ALLOW',
      policy_revision: '1',
      decision_id: '00000000-0000-4000-8000-000000000001',
    };
  }
}

export class DenyAuthorizer implements AuthorizationPort {
  async decide(_input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    return {
      allow: false,
      reason_code: 'TEST_DENY',
      policy_revision: '1',
      decision_id: '00000000-0000-4000-8000-000000000002',
    };
  }
}
