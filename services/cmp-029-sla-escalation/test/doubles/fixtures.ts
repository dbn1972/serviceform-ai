import type { AuthorizationPort } from '../../src/authz.js';
import type { ContextResolver } from '../../src/context.js';
import type {
  SlaNotificationPort,
  SlaNotificationRequest,
} from '../../src/ports/notification-port.js';
import type { AuthzDecisionInput, RequestContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_SYSTEM = '44444444-4444-4444-8444-444444444444';
export const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): RequestContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: ['SLA_OPERATOR'],
    jurisdiction_ids: [],
    auth_assurance: 'MFA',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    trace_id: '0123456789abcdef0123456789abcdef',
  };
}

export class AllowAllAuthorizer implements AuthorizationPort {
  readonly calls: AuthzDecisionInput[] = [];
  deny = false;
  fail = false;
  decide(input: AuthzDecisionInput): Promise<{
    allow: boolean;
    reason_code: string;
    policy_revision: string;
    decision_id: string;
  }> {
    this.calls.push(input);
    if (this.fail) return Promise.reject(new Error('pdp down'));
    return Promise.resolve({
      allow: !this.deny,
      reason_code: this.deny ? 'DENY' : 'ALLOW',
      policy_revision: 'rev-1',
      decision_id: '88888888-8888-4888-8888-888888888888',
    });
  }
}

export class RecordingNotifier implements SlaNotificationPort {
  readonly requests: SlaNotificationRequest[] = [];
  fail = false;
  requestNotification(request: SlaNotificationRequest): Promise<void> {
    if (this.fail) return Promise.reject(new Error('cmp-025 unavailable'));
    this.requests.push(request);
    return Promise.resolve();
  }
}

/** Test stand-in for CMP-036/CMP-004: reads the tenant from a server-side session table. */
export function resolverFor(ctx: RequestContext | (() => RequestContext | null)): ContextResolver {
  return () => Promise.resolve(typeof ctx === 'function' ? ctx() : ctx);
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
  advanceMinutes(minutes: number): void {
    this.ms += minutes * 60_000;
  }
}

export const CALENDAR_BODY = {
  calendar_code: 'WORKING_WEEK',
  utc_offset_minutes: 0,
  working_weekdays: [1, 2, 3, 4, 5],
  window_start_minute: 540,
  window_end_minute: 1020,
  holidays: ['2026-10-12'],
};

export function policyBody(
  calendarId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    policy_code: 'STANDARD_SERVICE_SLA',
    publication_ref: 'versioning:service-sla:v1',
    start_anchor: 'APPLICATION_RECEIVED',
    completion_anchor: 'DECISION_RECORDED',
    calendar_id: calendarId,
    duration_basis: 'WORKING_MINUTES',
    duration_minutes: 960,
    warning_before_minutes: 120,
    allowed_pause_reason_codes: ['DEFICIENCY_OPEN'],
    escalation_schedule: [
      { level: 1, after_deadline_minutes: 0, action_code: 'ESCALATE_SUPERVISOR' },
      { level: 2, after_deadline_minutes: 480, action_code: 'ESCALATE_HEAD' },
    ],
    ...overrides,
  };
}
