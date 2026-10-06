import { randomUUID } from 'node:crypto';
import {
  validate,
  type AuthzDecisionInput,
  type AuthzDecisionOutput,
  type RequestContext,
} from './contracts.js';
import type { Assignment } from './domain/assignment.js';
import { Cmp018Error, detail } from './errors.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export interface InspectionResource {
  inspection_id?: string;
  application_id?: string;
  workflow_node_id?: string | null;
  inspection_state?: string;
  owner_id?: string | null;
  assignment?: Assignment;
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
  resource: InspectionResource = {},
): AuthzDecisionInput {
  const res: AuthzDecisionInput['resource'] = {
    resource_type: 'Inspection',
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  };
  if (resource.inspection_id) res.task_id = resource.inspection_id;
  if (resource.application_id) res.application_id = resource.application_id;
  if (resource.owner_id) res.owner_id = resource.owner_id;
  if (resource.assignment) {
    res.organisation_id = resource.assignment.organisation_id;
    res.jurisdiction_id = resource.assignment.jurisdiction_id;
    if (resource.assignment.service_scope_id) res.service_id = resource.assignment.service_scope_id;
  }
  const input: AuthzDecisionInput = {
    subject: subjectOf(ctx),
    resource: res,
    action,
    environment: { trace_id: ctx.trace_id },
  };
  const wf: NonNullable<AuthzDecisionInput['workflow_context']> = {};
  if (resource.workflow_node_id) wf.workflow_node_id = resource.workflow_node_id;
  if (resource.assignment) wf.required_role = resource.assignment.role_code;
  if (resource.inspection_state) wf.task_state = resource.inspection_state;
  if (Object.keys(wf).length > 0) input.workflow_context = wf;
  return input;
}

export async function decide(
  port: AuthorizationPort,
  input: AuthzDecisionInput,
): Promise<AuthzRecord> {
  if (!validate('authz-decision-input', input).valid) throw new Cmp018Error('SF-AUTH-002');
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp018Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp018Error('SF-SYS-004', { ...detail('PDP_UNAVAILABLE'), cause: err });
  }
  if (!validate('authz-decision-output', output).valid) throw new Cmp018Error('SF-AUTH-002');
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
