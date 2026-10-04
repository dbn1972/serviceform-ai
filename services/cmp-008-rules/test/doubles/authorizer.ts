import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '@serviceform/contracts';
import type { AuthorizationPort } from '../../src/authz.js';

export class ContractAuthorizer implements AuthorizationPort {
  denies = new Set<string>();
  throws = false;

  async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    if (this.throws) throw new Error('pdp-timeout');
    const checked = validate('authz-decision-input', input);
    const allow =
      checked.valid &&
      !this.denies.has(`${input.action}:${input.resource.tenant_id ?? 'none'}`) &&
      !this.denies.has(input.action);
    return {
      allow,
      reason_code: allow ? 'ALLOW' : 'DEFAULT_DENY',
      policy_revision: 'test-1',
      decision_id: randomUUID(),
    };
  }
}
