import { Cmp027Error, detail } from './errors.js';
import { isAuthzDecisionOutput, type TenantRequestContext } from './domain/validate.js';
import type { AuthorizationPort, AuthzDecisionInput } from './ports/authorization.js';
import { RESOURCE_TYPE } from './events.js';

export interface AuthzOutcome {
  decisionId: string;
  policyRevision: string;
}

export interface ResourceAttributes {
  grievanceId?: string;
  ownerId?: string;
  serviceId?: string | null;
  organisationId?: string | null;
  jurisdictionId?: string | null;
}

export function authzInput(
  ctx: TenantRequestContext,
  action: string,
  resource: ResourceAttributes,
  now: Date,
): AuthzDecisionInput {
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
  const res: AuthzDecisionInput['resource'] = {
    resource_type: RESOURCE_TYPE,
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  };
  if (resource.grievanceId) res.application_id = resource.grievanceId;
  if (resource.ownerId) res.owner_id = resource.ownerId;
  if (resource.serviceId) res.service_id = resource.serviceId;
  if (resource.organisationId) res.organisation_id = resource.organisationId;
  if (resource.jurisdictionId) res.jurisdiction_id = resource.jurisdictionId;
  return {
    subject,
    resource: res,
    action,
    environment: { request_time: now.toISOString(), trace_id: ctx.trace_id },
  };
}

export async function authorizeAction(
  port: AuthorizationPort,
  ctx: TenantRequestContext,
  action: string,
  resource: ResourceAttributes,
  now: Date,
): Promise<AuthzOutcome> {
  let output: unknown;
  try {
    output = await port.decide(authzInput(ctx, action, resource, now));
  } catch (err) {
    if (err instanceof Cmp027Error) throw err;
    throw new Cmp027Error('SF-SYS-004', { details: detail('PDP_UNAVAILABLE'), cause: err });
  }
  if (!isAuthzDecisionOutput(output) || output.allow !== true) {
    throw new Cmp027Error('SF-AUTH-002');
  }
  return { decisionId: output.decision_id, policyRevision: output.policy_revision };
}
