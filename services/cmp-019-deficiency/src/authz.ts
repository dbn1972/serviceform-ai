import { Cmp019Error } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const DEFICIENCY_ACTIONS = {
  open: 'DEFICIENCY_OPEN',
  respond: 'DEFICIENCY_RESPOND',
  close: 'DEFICIENCY_CLOSE',
  read: 'DEFICIENCY_READ',
} as const;
export type DeficiencyAction = (typeof DEFICIENCY_ACTIONS)[keyof typeof DEFICIENCY_ACTIONS];

export function authzInput(
  ctx: RequestContext,
  action: DeficiencyAction,
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
      resource_type: 'DeficiencyNotice',
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
    throw new Cmp019Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp019Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp019Error('SF-AUTH-002');
}
