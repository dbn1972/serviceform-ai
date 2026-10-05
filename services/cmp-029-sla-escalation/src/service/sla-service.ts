import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  SLA_ACTIONS,
  type AuthorizationPort,
  type SlaAction,
} from '../authz.js';
import { CalendarHorizonError, validateCalendar, type CalendarSpec } from '../domain/calendar.js';
import {
  applyTransition,
  ClockRuleViolation,
  decideComplete,
  decidePause,
  decideResume,
  evaluateClock,
  startClock,
  type ClockState,
  type ClockTransition,
  type PolicySpec,
} from '../domain/clock.js';
import { Cmp029Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type {
  DeficiencyClockCommand,
  DeficiencyClockPort,
  DeficiencyClockResult,
} from '../ports/deficiency-clock-port.js';
import type { SlaNotificationPort, SlaNotificationRequest } from '../ports/notification-port.js';
import type {
  CalendarRow,
  ClockRow,
  HistoryRow,
  PolicyRow,
  SlaRepository,
  SlaTx,
} from '../repo/types.js';
import type { TenantContext } from '../types.js';
import { validateCalendarInput, validatePolicyInput } from './input.js';
import type { CalendarInput, PolicyInput } from './input.js';

export interface SlaServiceDeps {
  repo: SlaRepository;
  authorizer: AuthorizationPort;
  notifier: SlaNotificationPort;
  /** Server-authoritative time source. The only clock the service ever consults. */
  clock: () => Date;
}

export interface Idempotency {
  key: string;
  fingerprint: string;
  endpoint: string;
}

export interface CommandResult {
  status: number;
  body: unknown;
}

export interface StartClockInput {
  application_id: string;
  policy_id: string;
  stage_code: string;
  start_anchor: string;
  anchor_event_ref?: string;
}

export const DEFAULT_STAGE_CODE = 'OVERALL';

const EVENT_BY_OPERATION: Record<ClockTransition['operation'], DomainEventType> = {
  START: 'SlaClockStarted',
  PAUSE: 'SlaClockPaused',
  RESUME: 'SlaClockResumed',
  COMPLETE: 'SlaClockCompleted',
  WARN: 'SlaBreachApproaching',
  BREACH: 'SlaBreached',
  ESCALATE: 'EscalationTriggered',
};

const NOTIFY_BY_OPERATION: Partial<
  Record<ClockTransition['operation'], SlaNotificationRequest['kind']>
> = {
  WARN: 'SLA_BREACH_APPROACHING',
  BREACH: 'SLA_BREACHED',
  ESCALATE: 'SLA_ESCALATED',
};

interface Committed {
  status: number;
  body: unknown;
  notifications: SlaNotificationRequest[];
}

export function calendarSpec(row: CalendarRow): CalendarSpec {
  return {
    utc_offset_minutes: row.utc_offset_minutes,
    working_weekdays: row.working_weekdays,
    window_start_minute: row.window_start_minute,
    window_end_minute: row.window_end_minute,
    holidays: row.holidays,
  };
}

export function policySpec(row: PolicyRow): PolicySpec {
  return {
    start_anchor: row.start_anchor,
    completion_anchor: row.completion_anchor,
    duration_basis: row.duration_basis,
    duration_minutes: row.duration_minutes,
    warning_before_minutes: row.warning_before_minutes,
    allowed_pause_reason_codes: row.allowed_pause_reason_codes,
    escalation_schedule: row.escalation_schedule,
  };
}

export function clockStateOf(row: ClockRow): ClockState {
  return {
    status: row.status,
    started_at: row.started_at,
    deadline_at: row.deadline_at,
    remaining_ms: row.remaining_ms,
    paused_at: row.paused_at,
    pause_reason_code: row.pause_reason_code,
    pause_count: row.pause_count,
    resumed_at: row.resumed_at,
    completed_at: row.completed_at,
    breach_at: row.breach_at,
    warning_emitted_at: row.warning_emitted_at,
    escalation_level: row.escalation_level,
  };
}

/** Contract-conformant projection (SF-CON-SLA-CLOCK) plus SLA-only detail. */
export function clockView(row: ClockRow): {
  sla_clock: Record<string, unknown>;
  detail: Record<string, unknown>;
} {
  const contract: Record<string, unknown> = {
    contract_id: 'SF-CON-SLA-CLOCK',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    owner_component: 'CMP-029',
    tenant_id: row.tenant_id,
    application_id: row.application_id,
    clock_id: row.clock_id,
    sla_policy_version_id: row.policy_id,
    calendar_version_id: row.calendar_id,
    start_anchor: row.start_anchor,
    completion_anchor: row.completion_anchor,
    clock_status: row.status,
    deadline_at: row.deadline_at,
    server_computed_deadline: true,
    escalation_level: row.escalation_level,
    notification_port: 'M06_CMP025',
  };
  if (row.status === 'PAUSED' && row.pause_reason_code !== null) {
    contract['pause_reason_code'] = row.pause_reason_code;
    contract['pause_allowed_by_published_sla'] = true;
  }
  if (row.breach_at !== null) contract['breach_at'] = row.breach_at;
  return {
    sla_clock: contract,
    detail: {
      stage_code: row.stage_code,
      started_at: row.started_at,
      paused_at: row.paused_at,
      resumed_at: row.resumed_at,
      completed_at: row.completed_at,
      pause_count: row.pause_count,
      warning_emitted_at: row.warning_emitted_at,
      aggregate_version: row.aggregate_version,
    },
  };
}

function historyView(h: HistoryRow): Record<string, unknown> {
  return {
    sequence_no: h.sequence_no,
    operation: h.operation,
    from_status: h.from_status,
    to_status: h.to_status,
    occurred_at: h.occurred_at,
    reason_code: h.reason_code,
    deadline_before: h.deadline_before,
    deadline_after: h.deadline_after,
    escalation_level: h.escalation_level,
    actor_type: h.actor_type,
    actor_id: h.actor_id,
    correlation_id: h.correlation_id,
  };
}

function transitionView(t: ClockTransition): Record<string, unknown> {
  return {
    operation: t.operation,
    from_status: t.from_status,
    to_status: t.to_status,
    occurred_at: t.occurred_at,
    reason_code: t.reason_code,
    deadline_after: t.deadline_after,
    escalation_level: t.escalation_level,
  };
}

export class SlaService implements DeficiencyClockPort {
  constructor(private readonly deps: SlaServiceDeps) {}

  private async guard(
    ctx: TenantContext,
    action: SlaAction,
    resourceType: string,
    applicationId?: string,
  ): Promise<void> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp029Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType, applicationId));
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (
      tx: SlaTx,
      now: Date,
    ) => Promise<{ status: number; body: unknown; notifications?: SlaNotificationRequest[] }>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    const outcome = await this.deps.repo.withTx(
      ctx,
      async (tx): Promise<Committed & { replayed: boolean }> => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') return { ...claim, notifications: [], replayed: true };
        const result = await fn(tx, now);
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: result.body,
        });
        return {
          status: result.status,
          body: result.body,
          notifications: result.notifications ?? [],
          replayed: false,
        };
      },
    );
    if (!outcome.replayed) await this.notify(outcome.notifications);
    return { status: outcome.status, body: outcome.body };
  }

  /** Runs after commit. A notification failure never changes authoritative SLA state. */
  private async notify(requests: readonly SlaNotificationRequest[]): Promise<void> {
    for (const request of requests) {
      try {
        await this.deps.notifier.requestNotification(request);
      } catch {
        // CMP-025 is reached through the outbox event as well; delivery is not this service's job.
      }
    }
  }

  private async auditDenied(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    reason: string,
  ): Promise<void> {
    try {
      const now = this.deps.clock();
      await this.deps.repo.withTx(ctx, (tx) =>
        appendAudit(tx, ctx, {
          action,
          actionClass: 'WRITE',
          resourceType: 'SlaClock',
          resourceId,
          result: 'DENIED',
          reason,
          now,
        }),
      );
    } catch {
      // The refusal itself is already surfaced to the caller; audit best effort on this path.
    }
  }

  private async withRuleDenialAudit<T>(
    ctx: TenantContext,
    action: string,
    resourceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Cmp029Error && err.code === 'SF-APP-001') {
        await this.auditDenied(ctx, action, resourceId, err.details?.[0]?.code ?? 'RULE_VIOLATION');
      }
      throw err;
    }
  }

  async createCalendar(
    ctx: TenantContext,
    input: CalendarInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.calendarCreate, 'SlaCalendar');
    const clean = validateCalendarInput(input);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const calendarId = randomUUID();
      const version = (await tx.latestCalendarVersion(clean.calendar_code)) + 1;
      const row: CalendarRow = {
        calendar_id: calendarId,
        calendar_code: clean.calendar_code,
        version_no: version,
        utc_offset_minutes: clean.utc_offset_minutes,
        working_weekdays: [...clean.working_weekdays].sort((a, b) => a - b),
        window_start_minute: clean.window_start_minute,
        window_end_minute: clean.window_end_minute,
        holidays: [...clean.holidays].sort(),
        effective_from: now.toISOString(),
      };
      const problem = validateCalendar(calendarSpec(row));
      if (problem) throw new Cmp029Error('SF-SYS-003', detail(problem));
      await tx.insertCalendar({ ...row, created_by: ctx.actor.id });
      await appendAudit(tx, ctx, {
        action: 'SLA_CALENDAR_CREATE',
        actionClass: 'WRITE',
        resourceType: 'SlaCalendar',
        resourceId: calendarId,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 201,
        body: {
          calendar_version_id: calendarId,
          calendar_code: row.calendar_code,
          version_no: version,
        },
      };
    });
  }

  async createPolicy(
    ctx: TenantContext,
    input: PolicyInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.policyCreate, 'SlaPolicy');
    const clean = validatePolicyInput(input);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const calendar = await tx.getCalendar(clean.calendar_id);
      if (!calendar)
        throw new Cmp029Error('SF-SYS-002', detail('CALENDAR_UNAVAILABLE', '/calendar_id'));
      const policyId = randomUUID();
      const version = (await tx.latestPolicyVersion(clean.policy_code)) + 1;
      const row: PolicyRow = {
        policy_id: policyId,
        policy_code: clean.policy_code,
        version_no: version,
        status: 'PUBLISHED',
        publication_ref: clean.publication_ref,
        start_anchor: clean.start_anchor,
        completion_anchor: clean.completion_anchor,
        calendar_id: clean.calendar_id,
        duration_basis: clean.duration_basis,
        duration_minutes: clean.duration_minutes,
        warning_before_minutes: clean.warning_before_minutes,
        allowed_pause_reason_codes: [...clean.allowed_pause_reason_codes],
        escalation_schedule: clean.escalation_schedule.map((s) => ({ ...s })),
      };
      await tx.insertPolicy({ ...row, created_by: ctx.actor.id });
      await appendAudit(tx, ctx, {
        action: 'SLA_POLICY_CREATE',
        actionClass: 'WRITE',
        resourceType: 'SlaPolicy',
        resourceId: policyId,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 201,
        body: {
          sla_policy_version_id: policyId,
          policy_code: row.policy_code,
          version_no: version,
          status: row.status,
        },
      };
    });
  }

  async retirePolicy(
    ctx: TenantContext,
    policyId: string,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.policyRetire, 'SlaPolicy');
    return this.idempotent(ctx, idem, async (tx, now) => {
      const policy = await tx.getPolicy(policyId);
      if (!policy) throw new Cmp029Error('SF-SYS-002');
      if (policy.status !== 'PUBLISHED')
        throw new Cmp029Error('SF-APP-001', detail('POLICY_NOT_PUBLISHED'));
      await tx.retirePolicy(policyId, now);
      await appendAudit(tx, ctx, {
        action: 'SLA_POLICY_RETIRE',
        actionClass: 'WRITE',
        resourceType: 'SlaPolicy',
        resourceId: policyId,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: { sla_policy_version_id: policyId, status: 'RETIRED' } };
    });
  }

  async start(
    ctx: TenantContext,
    input: StartClockInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockStart, 'SlaClock', input.application_id);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const policy = await tx.getPolicy(input.policy_id);
      if (!policy) throw new Cmp029Error('SF-SYS-002', detail('POLICY_NOT_FOUND', '/policy_id'));
      if (policy.status !== 'PUBLISHED')
        throw new Cmp029Error('SF-APP-001', detail('POLICY_NOT_PUBLISHED'));
      if (input.start_anchor !== policy.start_anchor) {
        throw new Cmp029Error('SF-APP-001', detail('START_ANCHOR_MISMATCH', '/start_anchor'));
      }
      const calendar = await tx.getCalendar(policy.calendar_id);
      if (!calendar) throw new Cmp029Error('SF-SYS-002', detail('CALENDAR_UNAVAILABLE'));
      if (await tx.findClock(input.application_id, input.stage_code)) {
        throw new Cmp029Error('SF-APP-002', detail('CLOCK_ALREADY_STARTED'));
      }
      let started: ReturnType<typeof startClock>;
      try {
        started = startClock(policySpec(policy), calendarSpec(calendar), now.getTime());
      } catch (err) {
        if (err instanceof CalendarHorizonError) {
          throw new Cmp029Error('SF-SYS-003', detail('CALENDAR_HORIZON_EXCEEDED'));
        }
        throw err;
      }
      const row: ClockRow = {
        ...started.state,
        tenant_id: ctx.tenant_id,
        clock_id: randomUUID(),
        cell_id: ctx.cell_id,
        application_id: input.application_id,
        stage_code: input.stage_code,
        policy_id: policy.policy_id,
        calendar_id: calendar.calendar_id,
        start_anchor: policy.start_anchor,
        completion_anchor: policy.completion_anchor,
        anchor_event_ref: input.anchor_event_ref ?? null,
        aggregate_version: 1,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      await tx.insertClock(row);
      await tx.appendHistory(this.historyRow(ctx, row.clock_id, 1, started.transition));
      await this.emit(tx, ctx, row, started.transition, 1);
      await appendAudit(tx, ctx, {
        action: 'SLA_CLOCK_START',
        actionClass: 'WRITE',
        resourceType: 'SlaClock',
        resourceId: row.clock_id,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 201,
        body: { ...clockView(row), transitions: [transitionView(started.transition)] },
      };
    });
  }

  async pause(
    ctx: TenantContext,
    clockId: string,
    input: { reason_code: string },
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockPause, 'SlaClock');
    return this.withRuleDenialAudit(ctx, 'SLA_CLOCK_PAUSE', clockId, () =>
      this.transition(
        ctx,
        clockId,
        idem,
        SLA_ACTIONS.clockPause,
        (row, policy, calendar, nowMs) => [
          decidePause(
            clockStateOf(row),
            policySpec(policy),
            calendarSpec(calendar),
            nowMs,
            input.reason_code,
          ),
        ],
      ),
    );
  }

  async resume(ctx: TenantContext, clockId: string, idem: Idempotency): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockResume, 'SlaClock');
    return this.withRuleDenialAudit(ctx, 'SLA_CLOCK_RESUME', clockId, () =>
      this.transition(
        ctx,
        clockId,
        idem,
        SLA_ACTIONS.clockResume,
        (row, policy, calendar, nowMs) => [
          decideResume(clockStateOf(row), policySpec(policy), calendarSpec(calendar), nowMs),
        ],
      ),
    );
  }

  async complete(
    ctx: TenantContext,
    clockId: string,
    input: { completion_anchor: string },
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockComplete, 'SlaClock');
    return this.withRuleDenialAudit(ctx, 'SLA_CLOCK_COMPLETE', clockId, () =>
      this.transition(
        ctx,
        clockId,
        idem,
        SLA_ACTIONS.clockComplete,
        (row, policy, _calendar, nowMs) => [
          decideComplete(clockStateOf(row), policySpec(policy), nowMs, input.completion_anchor),
        ],
      ),
    );
  }

  async evaluate(ctx: TenantContext, clockId: string, idem: Idempotency): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockEvaluate, 'SlaClock');
    return this.transition(
      ctx,
      clockId,
      idem,
      SLA_ACTIONS.clockEvaluate,
      (row, policy, calendar, nowMs) =>
        evaluateClock(clockStateOf(row), policySpec(policy), calendarSpec(calendar), nowMs),
    );
  }

  private async transition(
    ctx: TenantContext,
    clockId: string,
    idem: Idempotency,
    action: SlaAction,
    decide: (
      row: ClockRow,
      policy: PolicyRow,
      calendar: CalendarRow,
      nowMs: number,
    ) => ClockTransition[],
  ): Promise<CommandResult> {
    return this.idempotent(ctx, idem, async (tx, now) => {
      const row = await tx.lockClock(clockId);
      if (!row) throw new Cmp029Error('SF-SYS-002');
      const policy = await tx.getPolicy(row.policy_id);
      const calendar = await tx.getCalendar(row.calendar_id);
      if (!policy || !calendar)
        throw new Cmp029Error('SF-SYS-002', detail('PINNED_VERSION_UNAVAILABLE'));
      let transitions: ClockTransition[];
      try {
        transitions = decide(row, policy, calendar, now.getTime());
      } catch (err) {
        if (err instanceof ClockRuleViolation)
          throw new Cmp029Error('SF-APP-001', detail(err.rule));
        if (err instanceof CalendarHorizonError) {
          throw new Cmp029Error('SF-SYS-003', detail('CALENDAR_HORIZON_EXCEEDED'));
        }
        throw err;
      }
      let state = clockStateOf(row);
      let version = row.aggregate_version;
      const notifications: SlaNotificationRequest[] = [];
      let last = row;
      for (const t of transitions) {
        state = applyTransition(state, t);
        await tx.updateClock(clockId, state, version, now);
        version += 1;
        last = { ...row, ...state, aggregate_version: version, updated_at: now.toISOString() };
        await tx.appendHistory(this.historyRow(ctx, clockId, version, t));
        const eventId = await this.emit(tx, ctx, last, t, version);
        const kind = NOTIFY_BY_OPERATION[t.operation];
        if (kind) {
          notifications.push({
            notification_port: 'M06_CMP025',
            tenant_id: ctx.tenant_id,
            application_id: row.application_id,
            clock_id: clockId,
            kind,
            escalation_level: t.escalation_level,
            escalation_action_code: t.operation === 'ESCALATE' ? t.reason_code : null,
            source_event_id: eventId,
          });
        }
      }
      if (transitions.length > 0) {
        await appendAudit(tx, ctx, {
          action,
          actionClass: 'WRITE',
          resourceType: 'SlaClock',
          resourceId: clockId,
          result: 'SUCCESS',
          now,
        });
      }
      return {
        status: 200,
        body: { ...clockView(last), transitions: transitions.map(transitionView) },
        notifications,
      };
    });
  }

  private historyRow(
    ctx: TenantContext,
    clockId: string,
    sequenceNo: number,
    t: ClockTransition,
  ): HistoryRow {
    return {
      ...t,
      clock_id: clockId,
      sequence_no: sequenceNo,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
    };
  }

  private async emit(
    tx: SlaTx,
    ctx: TenantContext,
    row: ClockRow,
    t: ClockTransition,
    version: number,
  ): Promise<string> {
    const data: Record<string, unknown> = {
      clock_id: row.clock_id,
      application_id: row.application_id,
      stage_code: row.stage_code,
      sla_policy_version_id: row.policy_id,
      calendar_version_id: row.calendar_id,
      clock_status: t.to_status,
      operation: t.operation,
      deadline_at: t.deadline_after,
      escalation_level: t.escalation_level,
      server_computed_deadline: true,
      notification_port: 'M06_CMP025',
    };
    if (t.reason_code !== null) data['reason_code'] = t.reason_code;
    if (t.to_status === 'BREACHED' && row.breach_at !== null) data['breach_at'] = row.breach_at;
    const envelope = envelopeOf({
      eventType: EVENT_BY_OPERATION[t.operation],
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'SlaClock',
      aggregateId: row.clock_id,
      aggregateVersion: version,
      occurredAt: t.occurred_at,
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data,
    });
    await tx.insertOutbox(envelope, TOPIC_DOMAIN);
    return envelope.event_id;
  }

  async getClock(ctx: TenantContext, clockId: string): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockRead, 'SlaClock');
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getClock(clockId);
      if (!row) throw new Cmp029Error('SF-SYS-002');
      return { status: 200, body: clockView(row) };
    });
  }

  async getHistory(ctx: TenantContext, clockId: string): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockRead, 'SlaClock');
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getClock(clockId);
      if (!row) throw new Cmp029Error('SF-SYS-002');
      const history = await tx.listHistory(clockId);
      return { status: 200, body: { clock_id: clockId, history: history.map(historyView) } };
    });
  }

  async clocksForApplication(ctx: TenantContext, applicationId: string): Promise<CommandResult> {
    await this.guard(ctx, SLA_ACTIONS.clockRead, 'SlaClock', applicationId);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.clocksForApplication(applicationId);
      return { status: 200, body: { application_id: applicationId, clocks: rows.map(clockView) } };
    });
  }

  private async resolveDeficiencyClock(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<ClockRow> {
    const stage = command.stage_code ?? DEFAULT_STAGE_CODE;
    const row = await this.deps.repo.withTx(ctx, (tx) =>
      tx.findClock(command.application_id, stage),
    );
    if (!row) throw new Cmp029Error('SF-SYS-002', detail('CLOCK_NOT_FOUND'));
    return row;
  }

  private toDeficiencyResult(body: unknown): DeficiencyClockResult {
    const view = body as ReturnType<typeof clockView>;
    const c = view.sla_clock;
    return {
      clock_id: String(c['clock_id']),
      application_id: String(c['application_id']),
      clock_status: c['clock_status'] as DeficiencyClockResult['clock_status'],
      deadline_at: String(c['deadline_at']),
      pause_reason_code: (c['pause_reason_code'] as string | undefined) ?? null,
    };
  }

  async pauseForDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    const row = await this.resolveDeficiencyClock(ctx, command);
    const res = await this.pause(
      ctx,
      row.clock_id,
      { reason_code: command.reason_code },
      {
        key: command.idempotency_key,
        fingerprint: `int009:pause:${row.clock_id}:${command.reason_code}`,
        endpoint: 'INT-009 pause',
      },
    );
    return this.toDeficiencyResult(res.body);
  }

  async resumeAfterDeficiency(
    ctx: TenantContext,
    command: DeficiencyClockCommand,
  ): Promise<DeficiencyClockResult> {
    const row = await this.resolveDeficiencyClock(ctx, command);
    const res = await this.resume(ctx, row.clock_id, {
      key: command.idempotency_key,
      fingerprint: `int009:resume:${row.clock_id}`,
      endpoint: 'INT-009 resume',
    });
    return this.toDeficiencyResult(res.body);
  }
}
