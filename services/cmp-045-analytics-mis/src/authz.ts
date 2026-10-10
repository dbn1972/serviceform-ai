import { Cmp045Error } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

/** OPA policy enforcement point. Fail closed: any error or non-allow denies. */
export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const ANALYTICS_ACTIONS = {
  definitionCreate: 'ANALYTICS_DEFINITION_CREATE',
  definitionRetire: 'ANALYTICS_DEFINITION_RETIRE',
  definitionRead: 'ANALYTICS_DEFINITION_READ',
  metricRead: 'ANALYTICS_METRIC_READ',
  eventIngest: 'ANALYTICS_EVENT_INGEST',
  projectionRebuild: 'ANALYTICS_PROJECTION_REBUILD',
} as const;
export type AnalyticsAction = (typeof ANALYTICS_ACTIONS)[keyof typeof ANALYTICS_ACTIONS];

export function authzInput(
  ctx: RequestContext,
  action: AnalyticsAction,
  resourceType: string,
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
      resource_type: resourceType,
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
    throw new Cmp045Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp045Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp045Error('SF-AUTH-002');
}
