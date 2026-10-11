import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
  type RequestContext,
} from '@serviceform/contracts';
import { Cmp007Error } from './errors.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export function subjectOf(ctx: RequestContext): AuthzDecisionInput['subject'] {
  return {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
    assurance: ctx.auth_assurance,
  };
}

export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  if (!validate('authz-decision-input', input).valid) throw new Cmp007Error('SF-AUTH-002');
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp007Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp007Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (!validate('authz-decision-output', output).valid || output.allow !== true) {
    throw new Cmp007Error('SF-AUTH-002');
  }
}

export function authzInput(
  ctx: RequestContext,
  action: string,
  resourceType: string,
  resource: { owner_id?: string; application_id?: string } = {},
): AuthzDecisionInput {
  return {
    subject: subjectOf(ctx),
    resource: {
      resource_type: resourceType,
      tenant_id: ctx.tenant_id,
      classification: 'TENANT_SCOPED',
      ...resource,
    },
    action,
    environment: { trace_id: ctx.trace_id },
  };
}
