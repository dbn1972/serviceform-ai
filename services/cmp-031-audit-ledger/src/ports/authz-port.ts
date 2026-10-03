import type { AuthzDecisionInput, AuthzDecisionOutput } from '@serviceform/contracts';

export interface AuthzPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export function denyAllAuthz(): AuthzPort {
  return {
    async decide(): Promise<AuthzDecisionOutput> {
      return {
        allow: false,
        reason_code: 'DENY',
        policy_revision: 'w1-deny',
        decision_id: '00000000-0000-4000-8000-000000000000',
      };
    },
  };
}
