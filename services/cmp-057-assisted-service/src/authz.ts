import { Cmp057Error } from './errors.js';
import { isUuid } from './domain/uuid.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export interface ResourceScope {
  /** The applicant (applied_for) so OPA evaluates operator authority over this citizen. */
  ownerId?: string;
  applicationId?: string;
}

/**
 * The subject is always the authenticated operator (INT-015 step 1: operator authenticates as
 * self); the applicant is never the subject, only the resource owner.
 */
export function authzInput(
  ctx: RequestContext,
  action: string,
  resourceType: string,
  scope: ResourceScope = {},
): AuthzDecisionInput {
  const subject: AuthzDecisionInput['subject'] = {
    user_id: ctx.actor.id,
    actor_type: ctx.actor.type,
    tenant_id: ctx.tenant_id,
    roles: ctx.roles,
    jurisdiction_ids: ctx.jurisdiction_ids,
    assurance: ctx.auth_assurance,
  };
  if (ctx.organisation_id && isUuid(ctx.organisation_id)) {
    subject.organisation_id = ctx.organisation_id;
  }
  if (ctx.office_id && isUuid(ctx.office_id)) subject.office_id = ctx.office_id;
  if (ctx.delegation_id && isUuid(ctx.delegation_id)) subject.delegation_id = ctx.delegation_id;
  const resource: AuthzDecisionInput['resource'] = {
    resource_type: resourceType,
    tenant_id: ctx.tenant_id,
    classification: 'TENANT_SCOPED',
  };
  if (scope.ownerId !== undefined) resource.owner_id = scope.ownerId;
  if (scope.applicationId !== undefined) resource.application_id = scope.applicationId;
  return { subject, resource, action, environment: { trace_id: ctx.trace_id } };
}

export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp057Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp057Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp057Error('SF-AUTH-002');
}
