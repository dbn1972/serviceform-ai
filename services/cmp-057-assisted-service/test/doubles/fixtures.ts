import type { AuthorizationPort } from '../../src/authz.js';
import type { AssistedVerificationPort } from '../../src/verification.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

/** Synthetic identifiers only (same shape as the SF-CON-ASSISTED-SESSION examples). */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_VERIFIER = '77777777-7777-4777-8777-777777777770';
export const ACTOR_CITIZEN = '44444444-4444-4444-8444-444444444444';
export const ACTOR_CITIZEN_B = '55555555-5555-4555-8555-555555555555';
export const ACTOR_ADMIN = '22222222-2222-4222-8222-222222222222';
export const APPLICATION_1 = '66666666-6666-4666-8666-666666666666';
export const ASSURANCE_REF = 'assurance:citizen-identity/ref-0001';
export const CONSENT_REF = 'consent:assisted-readback/ref-0001';
export const AUTHORITY_REF = 'authority:representation/ref-0001';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : ['ASSISTED_OPERATOR'],
    jurisdiction_ids: ['jurisdiction-test-1'],
    organisation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    office_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    auth_assurance: 'MFA',
    correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

export class ScriptedVerification implements AssistedVerificationPort {
  applicants = new Set<string>([`${TENANT_A}:${ACTOR_CITIZEN}`, `${TENANT_A}:${ACTOR_CITIZEN_B}`]);
  consents = new Set<string>();
  failApplicant = false;
  failConsent = false;

  applicantInTenant(ctx: TenantContext, citizenId: string): Promise<boolean> {
    if (this.failApplicant) return Promise.reject(new Error('identity down'));
    return Promise.resolve(this.applicants.has(`${ctx.tenant_id}:${citizenId}`));
  }

  consentCaptured(
    ctx: TenantContext,
    p: { citizenId: string; consentRef: string; sessionId: string },
  ): Promise<boolean> {
    if (this.failConsent) return Promise.reject(new Error('consent down'));
    const key = `${ctx.tenant_id}:${p.citizenId}:${p.consentRef}:${p.sessionId}`;
    if (this.consents.size === 0) return Promise.resolve(true);
    return Promise.resolve(this.consents.has(key) || this.consents.has('*'));
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function startBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: 'COUNTER',
    applied_for_citizen_id: ACTOR_CITIZEN,
    ...over,
  };
}
