import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
} from '@serviceform/contracts';
import { Cmp009Error } from './errors.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  const inCheck = validate('authz-decision-input', input);
  if (!inCheck.valid) throw new Cmp009Error('SF-AUTH-002');
  if (
    input.resource.classification === 'TENANT_SCOPED' &&
    input.subject.tenant_id !== null &&
    input.resource.tenant_id !== null &&
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp009Error('SF-AUTH-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp009Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  const outCheck = validate('authz-decision-output', output);
  if (!outCheck.valid || output.allow !== true) throw new Cmp009Error('SF-AUTH-002');
}

export function denyAllAuthz(): AuthorizationPort {
  return {
    async decide() {
      return {
        allow: false,
        reason_code: 'DEFAULT_DENY',
        policy_revision: '0',
        decision_id: '00000000-0000-4000-8000-000000000000',
      };
    },
  };
}

export function authzInput(
  ctx: {
    tenant_id: string | null;
    actor: { id: string; type: AuthzDecisionInput['subject']['actor_type'] };
    roles: string[];
    jurisdiction_ids: string[];
    organisation_id?: string;
    office_id?: string;
    auth_assurance?: AuthzDecisionInput['subject']['assurance'];
    correlation_id: string;
    cell_id: string;
    trace_id?: string;
  },
  action: string,
  resourceType: string,
): AuthzDecisionInput {
  const subject: AuthzDecisionInput['subject'] = {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
  };
  if (ctx.organisation_id) subject.organisation_id = ctx.organisation_id;
  if (ctx.office_id) subject.office_id = ctx.office_id;
  if (ctx.auth_assurance) subject.assurance = ctx.auth_assurance;
  return {
    subject,
    resource: {
      resource_type: resourceType,
      tenant_id: ctx.tenant_id,
      classification: 'TENANT_SCOPED',
    },
    action,
    environment: {
      request_time: new Date().toISOString(),
      ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
    },
  };
}
