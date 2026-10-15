import type { AuthorizationPort } from '../../src/authz.js';
import type { NotificationPort } from '../../src/ports/notification.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

/** Synthetic identifiers only (same shape as SF-CON-APPOINTMENT examples). */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_ADMIN = '22222222-2222-4222-8222-222222222222';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_CITIZEN = '55555555-5555-4555-8555-555555555555';
export const TYPE_REF = 'meta:appointment-type:counter-visit';
export const SLOT_REF_1 = 'slot:calendar-1:2026-10-20T10:00';
export const SLOT_REF_2 = 'slot:calendar-1:2026-10-20T11:00';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_ADMIN,
  type: RequestContext['actor']['type'] = 'PRIVILEGED_ADMIN',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'CITIZEN' ? ['CITIZEN'] : ['SCHEDULER_ADMIN'],
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
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
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

export class ScriptedNotifier implements NotificationPort {
  readonly calls: unknown[] = [];
  fail = false;
  async notifyAppointment(req: unknown): Promise<void> {
    this.calls.push(req);
    if (this.fail) throw new Error('notify down');
  }
}
