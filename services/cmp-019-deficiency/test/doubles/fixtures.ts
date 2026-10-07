import type { AuthorizationPort } from '../../src/authz.js';
import type { ContextResolver } from '../../src/context.js';
import type {
  CaseCommand,
  CaseCommandPort,
  CaseCommandResult,
} from '../../src/ports/case-command-port.js';
import type {
  DeficiencyNotificationRequest,
  NotificationPort,
} from '../../src/ports/notification-port.js';
import type {
  DeficiencyClockCommand,
  DeficiencyClockResult,
  SlaClockPort,
} from '../../src/ports/sla-clock-port.js';
import type { AuthzDecisionInput, RequestContext, TenantContext } from '../../src/types.js';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '99999999-9999-4999-8999-999999999999';
export const ACTOR_OFFICER = '33333333-3333-4333-8333-333333333333';
export const ACTOR_CITIZEN = '55555555-5555-4555-8555-555555555555';
export const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';
export const EVIDENCE_REF = '66666666-6666-4666-8666-666666666666';

export function ctxFor(
  tenantId: string,
  actorId = ACTOR_OFFICER,
  type: RequestContext['actor']['type'] = 'OFFICER',
): TenantContext {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-test-1',
    actor: { type, id: actorId },
    roles: type === 'OFFICER' ? ['CASE_OFFICER'] : ['CITIZEN'],
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

export class RecordingNotifier implements NotificationPort {
  readonly requests: DeficiencyNotificationRequest[] = [];
  requestNotification(request: DeficiencyNotificationRequest): Promise<void> {
    this.requests.push(request);
    return Promise.resolve();
  }
}

export class RecordingSlaClock implements SlaClockPort {
  readonly pauses: DeficiencyClockCommand[] = [];
  readonly resumes: DeficiencyClockCommand[] = [];
  inTx = false;
  failNextPause = 0;
  failNextResume = 0;
  pauseForDeficiency(
    _ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    if (this.inTx) throw new Error('NETWORK_IN_TX');
    if (this.failNextPause > 0) {
      this.failNextPause -= 1;
      return Promise.reject(
        Object.assign(new Error('sla pause unavailable'), {
          code: 'SLA_PORT_DOWN',
          details: [{ code: 'SLA_PORT_DOWN' }],
        }),
      );
    }
    this.pauses.push(command);
    return Promise.resolve({
      clock_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      application_id: command.application_id,
      clock_status: 'PAUSED',
      deadline_at: '2026-10-20T00:00:00.000Z',
      pause_reason_code: command.reason_code,
    });
  }
  resumeAfterDeficiency(
    _ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    if (this.inTx) throw new Error('NETWORK_IN_TX');
    if (this.failNextResume > 0) {
      this.failNextResume -= 1;
      return Promise.reject(
        Object.assign(new Error('sla resume unavailable'), {
          code: 'SLA_PORT_DOWN',
          details: [{ code: 'SLA_PORT_DOWN' }],
        }),
      );
    }
    this.resumes.push(command);
    return Promise.resolve({
      clock_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      application_id: command.application_id,
      clock_status: 'RUNNING',
      deadline_at: '2026-10-21T00:00:00.000Z',
      pause_reason_code: null,
    });
  }
}

/** Mirrors CMP-015 Cmp015Error shape for STALE_EXPECTED_STATE / STALE_VERSION. */
export function cmp015StaleError(
  detailCode: 'STALE_EXPECTED_STATE' | 'STALE_VERSION',
  pointer: '/expected_state' | '/expected_version',
): Error {
  return Object.assign(new Error('Invalid application state transition'), {
    name: 'Cmp015Error',
    code: 'SF-APP-001',
    statusCode: 409,
    details: [{ code: detailCode, pointer }],
  });
}

export class RecordingCaseCommands implements CaseCommandPort {
  readonly commands: { applicationId: string; body: CaseCommand; key: string }[] = [];
  failNext = 0;
  staleNext = 0;
  /** CMP-015 STALE_EXPECTED_STATE (real detail code + pointer). */
  staleExpectedStateNext = 0;
  /** CMP-015 STALE_VERSION (real detail code + pointer). */
  staleVersionNext = 0;
  executeCommand(
    _ctx: TenantContext,
    applicationId: string,
    body: CaseCommand,
    key: string,
  ): Promise<CaseCommandResult> {
    if (this.staleExpectedStateNext > 0) {
      this.staleExpectedStateNext -= 1;
      return Promise.reject(cmp015StaleError('STALE_EXPECTED_STATE', '/expected_state'));
    }
    if (this.staleVersionNext > 0) {
      this.staleVersionNext -= 1;
      return Promise.reject(cmp015StaleError('STALE_VERSION', '/expected_version'));
    }
    if (this.staleNext > 0) {
      this.staleNext -= 1;
      return Promise.reject(
        Object.assign(new Error('stale expected version'), {
          code: 'STALE_EXPECTED_VERSION',
          details: [{ code: 'STALE_EXPECTED_VERSION' }],
        }),
      );
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(
        Object.assign(new Error('case port unavailable'), {
          code: 'CASE_PORT_DOWN',
          details: [{ code: 'CASE_PORT_DOWN' }],
        }),
      );
    }
    this.commands.push({ applicationId, body, key });
    return Promise.resolve({
      application_id: applicationId,
      state: body.command === 'RAISE_DEFICIENCY' ? 'DEFICIENCY_RAISED' : 'CITIZEN_RESPONSE',
      aggregate_version: body.expected_version + 1,
    });
  }
}

export function resolverFor(ctx: RequestContext | (() => RequestContext | null)): ContextResolver {
  return () => Promise.resolve(typeof ctx === 'function' ? ctx() : ctx);
}

export class MutableClock {
  constructor(private ms: number) {}
  now = (): Date => new Date(this.ms);
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
}

export const OPEN_BODY = {
  application_id: APPLICATION_ID,
  reason_code: 'MISSING_PROOF',
  notice_code: 'CLARIFY_ADDRESS',
  instruction_ref: 'ref:instruction:address-proof',
  case_expected_state: 'UNDER_SCRUTINY',
  case_expected_version: 8,
  response_due_at: '2026-10-20T10:00:00.000Z',
  items: [{ item_code: 'ADDRESS_PROOF', required: true }],
  evidence: [{ evidence_ref: EVIDENCE_REF, kind_code: 'NOTICE_ATTACHMENT' }],
};

export const RESPOND_BODY = {
  narrative_ref: 'ref:response:address-proof',
  provided_item_codes: ['ADDRESS_PROOF'],
  case_expected_state: 'DEFICIENCY_RAISED',
  case_expected_version: 9,
  evidence: [{ evidence_ref: EVIDENCE_REF, kind_code: 'CITIZEN_UPLOAD' }],
};
