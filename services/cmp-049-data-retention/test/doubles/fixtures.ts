import type { AuthorizationPort } from '../../src/authz.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

/** Synthetic identifiers only (same shape as the SF-CON-RETENTION-POLICY examples). */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_ADMIN = '22222222-2222-4222-8222-222222222222';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_CITIZEN = '55555555-5555-4555-8555-555555555555';
export const RESOURCE_1 = '44444444-4444-4444-8444-444444444444';
export const RESOURCE_2 = '66666666-6666-4666-8666-666666666666';
export const OWNER_PERIOD_REF = 'owner-input:retention-schedule/ref-0001';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_ADMIN,
  type: RequestContext['actor']['type'] = 'PRIVILEGED_ADMIN',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : ['RETENTION_ADMIN'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

export class ScriptedAuthorizer implements AuthorizationPort {
  readonly calls: AuthzDecisionInput[] = [];
  deniedActions = new Set<string>();
  denyAll = false;
  fail = false;
  onDecide: (() => void) | undefined;
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    this.onDecide?.();
    if (this.fail) return Promise.reject(new Error('pdp down'));
    const deny = this.denyAll || this.deniedActions.has(input.action);
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

export const FULL_TRANSITIONS = [
  { from_eligibility: 'ACTIVE', to_eligibility: 'ARCHIVE_ELIGIBLE' },
  { from_eligibility: 'ARCHIVE_ELIGIBLE', to_eligibility: 'DELETE_ELIGIBLE' },
  { from_eligibility: 'ACTIVE', to_eligibility: 'LEGAL_HOLD' },
  { from_eligibility: 'ARCHIVE_ELIGIBLE', to_eligibility: 'LEGAL_HOLD' },
  { from_eligibility: 'LEGAL_HOLD', to_eligibility: 'ACTIVE' },
  { from_eligibility: 'ARCHIVE_ELIGIBLE', to_eligibility: 'ACTIVE' },
] as const;

export function policyBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: { resource_type: 'APPLICATION', service_code: 'SVC_SYNTHETIC_01' },
    owner_supplied_period_ref: null,
    eligibility_transitions: FULL_TRANSITIONS.map((t) => ({ ...t })),
    ...over,
  };
}
