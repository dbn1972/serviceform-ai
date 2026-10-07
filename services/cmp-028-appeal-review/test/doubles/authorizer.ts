import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '../../src/contracts.js';
import type { AuthorizationPort } from '../../src/authz.js';

export class ScriptedAuthorizer implements AuthorizationPort {
  denyActions = new Set<string>();
  denyWhen: ((input: AuthzDecisionInput) => boolean) | null = null;
  throws = false;
  malformed = false;
  before: (() => Promise<void>) | null = null;
  policyRevision = 'rev-1';
  readonly calls: AuthzDecisionInput[] = [];

  async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    this.calls.push(input);
    if (this.before) await this.before();
    if (this.throws) throw new Error('pdp-timeout');
    if (this.malformed) return { allow: true } as unknown as AuthzDecisionOutput;
    const valid = validate('authz-decision-input', input).valid;
    const allow =
      valid && !this.denyActions.has(input.action) && !(this.denyWhen?.(input) ?? false);
    return {
      allow,
      reason_code: allow ? 'ALLOW' : 'DEFAULT_DENY',
      policy_revision: this.policyRevision,
      decision_id: randomUUID(),
    };
  }
}
