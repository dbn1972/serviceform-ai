import { randomUUID } from 'node:crypto';
import type { AuthorizationPort } from '../../src/authz.js';
import type { SchedulerRepository } from '../../src/repo/types.js';
import type {
  ActorType,
  AuthzDecisionInput,
  AuthzDecisionOutput,
  TenantContext,
} from '../../src/types.js';

/**
 * Synthetic identifiers and opaque metadata references only. No real office, hearing type,
 * holiday list, working-hours rule or statutory calendar is modelled here.
 */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const APPLICATION_ID = '33333333-3333-4333-8333-333333333333';
export const JURISDICTION_ID = '44444444-4444-4444-8444-444444444444';
export const ACTOR_SYSTEM = '77777777-7777-4777-8777-777777777777';
export const ACTOR_CITIZEN = '77777777-7777-4777-8777-777777777778';
export const ACTOR_CITIZEN_2 = '77777777-7777-4777-8777-777777777779';
export const ACTOR_OFFICER = '77777777-7777-4777-8777-77777777777a';
export const TYPE_REF = 'meta:appointment-type:synthetic-a';
export const OTHER_TYPE_REF = 'meta:appointment-type:synthetic-b';
export const CALENDAR_REF = 'meta:resource-calendar:synthetic-1';

export const START_ISO = '2026-10-14T04:00:00.000Z';

export function ctxFor(
  tenantId: string,
  actorId: string = ACTOR_SYSTEM,
  actorType: ActorType = 'SYSTEM',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-01',
    actor: { type: actorType, id: actorId },
    roles: [],
    jurisdiction_ids: [],
    auth_assurance: actorType === 'CITIZEN' ? 'OTP' : 'WORKLOAD_IDENTITY',
    correlation_id: randomUUID(),
    trace_id: '0af7651916cd43dd8448eb211c80319c',
  };
}

export function slotInput(
  slotRef: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slot_ref: slotRef,
    appointment_type_ref: TYPE_REF,
    resource_calendar_ref: CALENDAR_REF,
    jurisdiction_id: JURISDICTION_ID,
    starts_at: '2026-10-20T04:30:00Z',
    ends_at: '2026-10-20T05:00:00Z',
    capacity: 1,
    ...overrides,
  };
}

export class AllowAllAuthorizer implements AuthorizationPort {
  mode: 'allow' | 'deny' | 'throw' = 'allow';
  readonly calls: AuthzDecisionInput[] = [];
  repo: SchedulerRepository | null = null;
  violations = 0;

  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput> {
    if (this.repo?.inTransaction()) this.violations += 1;
    this.calls.push(input);
    if (this.mode === 'throw') return Promise.reject(new Error('pdp down'));
    return Promise.resolve({
      allow: this.mode === 'allow',
      reason_code: this.mode === 'allow' ? 'ALLOW' : 'DENY',
      policy_revision: 'rev-test',
      decision_id: randomUUID(),
    });
  }
}

export class MutableClock {
  constructor(private ms: number) {}
  readonly now = (): Date => new Date(this.ms);
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
}
