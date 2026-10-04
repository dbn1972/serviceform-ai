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
  lastInput: AuthzDecisionInput | undefined;

  async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    this.lastInput = input;
    if (this.throws) throw new Error('pdp-timeout');
    const checked = validate('authz-decision-input', input);
    if (!checked.valid) {
      return {
        allow: false,
        reason_code: 'DEFAULT_DENY',
        policy_revision: 'test-1',
        decision_id: randomUUID(),
      };
    }
    const allow =
      !this.denies.has(`${input.action}:${input.resource.tenant_id ?? 'none'}`) &&
      !this.denies.has(input.action);
    const output: AuthzDecisionOutput = {
      allow,
      reason_code: allow ? 'ALLOW' : 'DEFAULT_DENY',
      policy_revision: 'test-1',
      decision_id: randomUUID(),
    };
    const outCheck = validate('authz-decision-output', output);
    if (!outCheck.valid) {
      return {
        allow: false,
        reason_code: 'DEFAULT_DENY',
        policy_revision: 'test-1',
        decision_id: randomUUID(),
      };
    }
    return output;
  }
}
