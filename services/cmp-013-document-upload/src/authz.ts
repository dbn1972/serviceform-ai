import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
  type RequestContext,
} from '@serviceform/contracts';
import { Cmp013Error } from './errors.js';

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

/** PEP: fails closed on invalid input/output, PDP outage, or any tenant mismatch. */
export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  if (!validate('authz-decision-input', input).valid) throw new Cmp013Error('SF-AUTH-002');
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp013Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp013Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (!validate('authz-decision-output', output).valid || output.allow !== true) {
    throw new Cmp013Error('SF-AUTH-002');
  }
}
