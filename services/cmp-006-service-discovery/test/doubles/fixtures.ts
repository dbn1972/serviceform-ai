import type { AuthorizationPort } from '../../src/authz.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

/** Synthetic identifiers and codes only. No real tenant, jurisdiction, service or person. */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const CITIZEN_1 = '55555555-5555-4555-8555-555555555555';
export const CITIZEN_2 = '56565656-5656-4565-8565-565656565656';
export const OFFICER_1 = '33333333-3333-4333-8333-333333333333';
export const CATALOGUE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CATALOGUE_A_DRAFT = 'abababab-abab-4bab-8bab-abababababab';
export const CATALOGUE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const SVC_1 = 'c1111111-1111-4111-8111-111111111111';
export const SVC_2 = 'c2222222-2222-4222-8222-222222222222';
export const SVC_3 = 'c3333333-3333-4333-8333-333333333333';
export const SVC_B1 = 'cb111111-1111-4111-8111-111111111111';
export const BIND_1 = 'd1111111-1111-4111-8111-111111111111';
export const BIND_2 = 'd2222222-2222-4222-8222-222222222222';
export const BIND_3 = 'd3333333-3333-4333-8333-333333333333';
export const BIND_B1 = 'db111111-1111-4111-8111-111111111111';

/** Parent region JUR-P contains district JUR-P-01; JUR-Q is unrelated; JUR-OLD is inactive. */
export const JUR_PARENT = 'JUR-P';
export const JUR_CHILD = 'JUR-P-01';
export const JUR_OTHER = 'JUR-Q';
export const JUR_INACTIVE = 'JUR-OLD';

export function ctxFor(
  tenantId: string,
  actorId = CITIZEN_1,
  type: RequestContext['actor']['type'] = 'CITIZEN',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : ['OFFICER'],
    jurisdiction_ids: [],
    auth_assurance: type === 'CITIZEN' ? 'OTP' : 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
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

export function queryBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filters: { jurisdiction_codes: [JUR_CHILD] },
    catalogue_version_id: CATALOGUE_A,
    pagination: { limit: 20, offset: 0 },
    ...over,
  };
}
