import { Cmp012Error, detail } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, TenantContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const DIGILOCKER_ACTIONS = {
  publish: 'digilocker:publish',
  read: 'digilocker:read',
} as const;

export type DigilockerAction = (typeof DIGILOCKER_ACTIONS)[keyof typeof DIGILOCKER_ACTIONS];

export function authzInput(
  ctx: TenantContext,
  action: DigilockerAction,
  credentialId?: string,
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
      resource_type: 'DigiLockerPublish',
      tenant_id: ctx.tenant_id,
      ...(credentialId !== undefined ? { application_id: credentialId } : {}),
      classification: 'TENANT_SCOPED',
    },
    action,
    environment: { trace_id: ctx.trace_id },
  };
}

export async function authorize(
  authorizer: AuthorizationPort,
  input: AuthzDecisionInput,
): Promise<void> {
  let decision: AuthzDecisionOutput;
  try {
    decision = await authorizer.decide(input);
  } catch (err) {
    throw new Cmp012Error('SF-SYS-004', { ...detail('AUTHZ_PORT_UNAVAILABLE'), cause: err });
  }
  if (!decision.allow) {
    throw new Cmp012Error('SF-AUTH-002', detail(decision.reason_code));
  }
}
