import type { AuthorizationPort } from '../../src/authz.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

/** Synthetic identifiers and opaque refs only. No real tenant, issuer, credential or person. */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const OFFICER_1 = '33333333-3333-4333-8333-333333333333';
export const SYSTEM_1 = '44444444-4444-4444-8444-444444444444';
export const VERIFIER_1 = '55555555-5555-4555-8555-555555555555';
export const CRED_1 = '22222222-2222-4222-8222-222222222222';
export const CRED_2 = '23232323-2323-4323-8323-232323232323';
export const CRED_B1 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
export const CRED_DRAFT = '24242424-2424-4424-8424-242424242424';
export const TYPE_REF = 'credtype:tenant-meta:0001';
export const ISSUER_REF = 'issuer:tenant-meta:0001';
export const ISSUER_REF_B = 'issuer:tenant-meta:00b1';
export const SIGNED_SHA = 'b'.repeat(64);
export const ISSUED_AT = '2026-10-14T04:00:00.000Z';

export function ctxFor(
  tenantId: string,
  actorId = OFFICER_1,
  type: RequestContext['actor']['type'] = 'OFFICER',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : type === 'SYSTEM' ? ['WORKLOAD'] : ['OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: type === 'CITIZEN' ? 'NONE' : type === 'SYSTEM' ? 'WORKLOAD_IDENTITY' : 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

/** A public verifier as the host would present it: tenant from routing, no authentication. */
export function publicVerifierCtx(tenantId: string): TenantContext {
  return { ...ctxFor(tenantId, VERIFIER_1, 'CITIZEN'), roles: [], auth_assurance: 'NONE' };
}

export class ScriptedAuthorizer implements AuthorizationPort {
  readonly calls: AuthzDecisionInput[] = [];
  deniedActions = new Set<string>();
  fail = false;
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    if (this.fail) return Promise.reject(new Error('pdp down'));
    const deny = this.deniedActions.has(input.action);
    return Promise.resolve({
      allow: !deny,
      reason_code: deny ? 'DENY' : 'ALLOW',
      policy_revision: 'rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    });
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function issueBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { credential_id: CRED_1, credential_type_ref: TYPE_REF, ...over };
}
