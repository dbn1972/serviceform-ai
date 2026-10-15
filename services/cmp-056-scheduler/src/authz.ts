import { Cmp056Error } from './errors.js';
import type { AuthzDecisionInput, AuthzDecisionOutput, RequestContext } from './types.js';

export interface AuthorizationPort {
  decide(input: AuthzDecisionInput): Promise<AuthzDecisionOutput>;
}

export const SCHEDULER_ACTIONS = {
  publishSlot: 'APPOINTMENT_SLOT_PUBLISH',
  listSlots: 'APPOINTMENT_SLOT_LIST',
  book: 'APPOINTMENT_BOOK',
  read: 'APPOINTMENT_READ',
  reschedule: 'APPOINTMENT_RESCHEDULE',
  cancel: 'APPOINTMENT_CANCEL',
  recordAttendance: 'APPOINTMENT_ATTENDANCE_RECORD',
  recordNotification: 'APPOINTMENT_NOTIFICATION_OUTCOME_RECORD',
} as const;
export type SchedulerAction = (typeof SCHEDULER_ACTIONS)[keyof typeof SCHEDULER_ACTIONS];

export interface ResourceScope {
  resourceType: 'Appointment' | 'AppointmentSlot';
  jurisdictionId?: string | null;
  applicationId?: string | null;
  ownerId?: string | null;
}

export function authzInput(
  ctx: RequestContext,
  action: SchedulerAction,
  scope: ResourceScope,
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
      resource_type: scope.resourceType,
      tenant_id: ctx.tenant_id,
      ...(scope.jurisdictionId ? { jurisdiction_id: scope.jurisdictionId } : {}),
      ...(scope.applicationId ? { application_id: scope.applicationId } : {}),
      ...(scope.ownerId ? { owner_id: scope.ownerId } : {}),
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
    throw new Cmp056Error('SF-TEN-002');
  }
  let output: AuthzDecisionOutput;
  try {
    output = await port.decide(input);
  } catch (err) {
    throw new Cmp056Error('SF-SYS-004', { details: [{ code: 'PDP_UNAVAILABLE' }], cause: err });
  }
  if (output?.allow !== true) throw new Cmp056Error('SF-AUTH-002');
}
