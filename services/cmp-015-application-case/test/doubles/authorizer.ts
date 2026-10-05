import { randomUUID } from 'node:crypto';
import type { AuthzDecisionOutput } from '../../src/domain/validate.js';
import type { AuthorizationPort, AuthzDecisionInput } from '../../src/ports/authorization.js';

/**
 * SF-CON-AUTHZ-DECISION shaped PDP double. Denies cross-tenant resources and any action listed in
 * `denied`; `policyRevision` models the current effective published bundle (ADR-0005).
 */
export class ContractAuthorizer implements AuthorizationPort {
  readonly inputs: AuthzDecisionInput[] = [];
  readonly denied = new Set<string>();
  policyRevision = 'authz-bundle-1';
  failWith: Error | null = null;
  malformed = false;

  async decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    this.inputs.push(structuredClone(input));
    if (this.failWith) throw this.failWith;
    if (this.malformed) return { allow: true } as unknown as AuthzDecisionOutput;
    const crossTenant = input.subject.tenant_id !== input.resource.tenant_id;
    const allow = !crossTenant && !this.denied.has(input.action);
    return {
      allow,
      reason_code: allow ? 'ALLOW' : crossTenant ? 'CROSS_TENANT' : 'ACTION_DENIED',
      policy_revision: this.policyRevision,
      decision_id: randomUUID(),
    };
  }
}
