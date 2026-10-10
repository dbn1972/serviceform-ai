import { Cmp046Error } from './errors.js';
import { OPS_RESOURCE_TYPE } from './domain/model.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export function authzInput(ctx: RequestContext, action: string): AuthzDecisionInput {
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
      resource_type: OPS_RESOURCE_TYPE,
      tenant_id: ctx.tenant_id,
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
    throw new Cmp046Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp046Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp046Error('SF-AUTH-002');
}
