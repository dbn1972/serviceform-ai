import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
  type RequestContext,
} from './contracts.js';
import type { AppellateAuthority } from './domain/authority.js';
import { Cmp028Error, detail } from './errors.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export interface AppealResource {
  appeal_id?: string;
  application_id?: string;
  appeal_state?: string;
  authority?: AppellateAuthority;
}

export interface AuthzRecord {
  decision_id: string;
  policy_revision: string;
  reason_code: string;
  allow: boolean;
}

export function subjectOf(ctx: RequestContext): AuthzDecisionInput['subject'] {
  const subject: AuthzDecisionInput['subject'] = {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
    assurance: ctx.auth_assurance,
  };
  if (ctx.organisation_id) subject.organisation_id = ctx.organisation_id;
  if (ctx.office_id) subject.office_id = ctx.office_id;
  if (ctx.delegation_id) subject.delegation_id = ctx.delegation_id;
  return subject;
}

export function authzInput(
  ctx: RequestContext,
  action: string,
  resource: AppealResource = {},
): AuthzDecisionInput {
  const res: AuthzDecisionInput['resource'] = {
    resource_type: 'Appeal',
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  };
  if (resource.appeal_id) res.task_id = resource.appeal_id;
  if (resource.application_id) res.application_id = resource.application_id;
  if (resource.authority) {
    res.organisation_id = resource.authority.organisation_id;
    res.jurisdiction_id = resource.authority.jurisdiction_id;
    if (resource.authority.service_scope_id) res.service_id = resource.authority.service_scope_id;
  }
  const input: AuthzDecisionInput = {
    subject: subjectOf(ctx),
    resource: res,
    action,
    environment: { trace_id: ctx.trace_id },
  };
  const wf: NonNullable<AuthzDecisionInput['workflow_context']> = {};
  if (resource.authority) wf.required_role = resource.authority.role_code;
  if (resource.appeal_state) wf.task_state = resource.appeal_state;
  if (Object.keys(wf).length > 0) input.workflow_context = wf;
  return input;
}

export async function decide(
  port: AuthorizationPort,
  input: AuthzDecisionInput,
): Promise<AuthzRecord> {
  if (!validate('authz-decision-input', input).valid) throw new Cmp028Error('SF-AUTH-002');
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp028Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp028Error('SF-SYS-004', { ...detail('PDP_UNAVAILABLE'), cause: err });
  }
  if (!validate('authz-decision-output', output).valid) throw new Cmp028Error('SF-AUTH-002');
  return {
    decision_id: output.decision_id,
    policy_revision: output.policy_revision,
    reason_code: output.reason_code,
    allow: output.allow === true,
  };
}

export function denyAllAuthz(): AuthorizationPort {
  return {
    async decide() {
      return {
        allow: false,
        reason_code: 'DEFAULT_DENY',
        policy_revision: 'unconfigured',
        decision_id: randomUUID(),
      };
    },
  };
}
