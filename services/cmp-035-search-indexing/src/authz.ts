import { Cmp035Error, detail } from './errors.js';
import { isAuthzDecisionOutput, type TenantRequestContext } from './domain/validate.js';
import type { AuthorizationPort, AuthzDecisionInput } from './ports/authorization.js';
import { RESOURCE_TYPE } from './events.js';

export const ACTIONS = {
  query: 'SEARCH_DOCUMENT_QUERY',
  read: 'SEARCH_DOCUMENT_READ',
} as const;

export interface AuthzOutcome {
  decisionId: string;
  policyRevision: string;
}

export function authzInput(
  ctx: TenantRequestContext,
  action: string,
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
  return {
    subject,
    resource: {
      resource_type: RESOURCE_TYPE,
      tenant_id: ctx.tenant_id,
      classification: 'TENANT_SCOPED',
    },
    action,
    environment: { request_time: now.toISOString(), trace_id: ctx.trace_id },
  };
}

export async function authorizeAction(
  port: AuthorizationPort,
  ctx: TenantRequestContext,
  action: string,
  now: Date,
): Promise<AuthzOutcome> {
  let output: unknown;
  try {
    output = await port.decide(authzInput(ctx, action, now));
  } catch (err) {
    if (err instanceof Cmp035Error) throw err;
    throw new Cmp035Error('SF-SYS-004', { details: detail('PDP_UNAVAILABLE'), cause: err });
  }
  if (!isAuthzDecisionOutput(output) || output.allow !== true) {
    throw new Cmp035Error('SF-AUTH-002');
  }
  return { decisionId: output.decision_id, policyRevision: output.policy_revision };
}
