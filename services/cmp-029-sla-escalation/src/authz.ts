import { Cmp029Error } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

/** OPA policy enforcement point. Fail closed: any error or non-allow denies. */
export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const SLA_ACTIONS = {
  calendarCreate: 'SLA_CALENDAR_CREATE',
  policyCreate: 'SLA_POLICY_CREATE',
  policyRetire: 'SLA_POLICY_RETIRE',
  clockStart: 'SLA_CLOCK_START',
  clockPause: 'SLA_CLOCK_PAUSE',
  clockResume: 'SLA_CLOCK_RESUME',
  clockComplete: 'SLA_CLOCK_COMPLETE',
  clockEvaluate: 'SLA_CLOCK_EVALUATE',
  clockRead: 'SLA_CLOCK_READ',
} as const;
export type SlaAction = (typeof SLA_ACTIONS)[keyof typeof SLA_ACTIONS];

export function authzInput(
  ctx: RequestContext,
  action: SlaAction,
  resourceType: string,
  applicationId?: string,
): AuthzDecisionInput {
  return {
    subject: {
      user_id: ctx.actor.id,
      actor_type: ctx.actor.type,
      tenant_id: ctx.tenant_id,
      roles: ctx.roles,
      jurisdiction_ids: ctx.jurisdiction_ids,
      assurance: ctx.auth_assurance,
    },
    resource: {
      resource_type: resourceType,
      tenant_id: ctx.tenant_id,
      ...(applicationId === undefined ? {} : { application_id: applicationId }),
      classification: 'TENANT_SCOPED',
    },
    action,
    environment: { trace_id: ctx.trace_id },
  };
}

export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp029Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp029Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp029Error('SF-AUTH-002');
}
