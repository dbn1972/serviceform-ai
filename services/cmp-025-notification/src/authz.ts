import { Cmp025Error } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const NOTIFICATION_ACTIONS = {
  dispatch: 'NOTIFICATION_DISPATCH',
  read: 'NOTIFICATION_READ',
  deliver: 'NOTIFICATION_DELIVER',
  recordReceipt: 'NOTIFICATION_RECEIPT_RECORD',
  publishTemplate: 'NOTIFICATION_TEMPLATE_PUBLISH',
  readTemplate: 'NOTIFICATION_TEMPLATE_READ',
} as const;
export type NotificationAction = (typeof NOTIFICATION_ACTIONS)[keyof typeof NOTIFICATION_ACTIONS];

export function authzInput(
  ctx: RequestContext,
  action: NotificationAction,
  resourceType: 'NotificationDispatch' | 'NotificationTemplate',
  applicationId?: string,
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
      ...(applicationId === undefined ? {} : { application_id: applicationId }),
      classification: 'TENANT_SCOPED',
    },
    action,
    environment: { trace_id: ctx.trace_id },
  };
}

/** Fail-closed: PDP errors and non-allow decisions both refuse the request. */
export async function authorize(port: AuthorizationPort, input: AuthzDecisionInput): Promise<void> {
  if (
    input.subject.tenant_id === null ||
    input.resource.tenant_id === null ||
    input.subject.tenant_id !== input.resource.tenant_id
  ) {
    throw new Cmp025Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp025Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp025Error('SF-AUTH-002');
}
