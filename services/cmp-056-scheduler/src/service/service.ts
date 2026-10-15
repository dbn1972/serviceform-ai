import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  SCHEDULER_ACTIONS,
  type AuthorizationPort,
  type ResourceScope,
  type SchedulerAction,
} from '../authz.js';
import {
  appointmentView,
  assertTransition,
  EVENT_FOR_STATUS,
  type AppointmentRow,
  type LifecycleStatus,
} from '../domain/appointment.js';
import { notificationOutcomeView, type NotificationOutcomeRow } from '../domain/notification.js';
import { slotView, unavailableReason, type SlotRow } from '../domain/slot.js';
import { Cmp056Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN } from '../outbox.js';
import type { SchedulerRepository, SchedulerTx } from '../repo/types.js';
import type { ActorType, TenantContext } from '../types.js';
import type {
  AttendanceInput,
  BookInput,
  NotificationInput,
  RescheduleInput,
  SlotInput,
  SlotQuery,
} from './input.js';

export interface SchedulerServiceDeps {
  repo: SchedulerRepository;
  authorizer: AuthorizationPort;
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

const SLOT_PUBLISH_ACTORS: readonly ActorType[] = ['SYSTEM', 'OFFICER'];
const BOOKING_ACTORS: readonly ActorType[] = ['CITIZEN', 'OFFICER', 'SYSTEM'];
const ATTENDANCE_ACTORS: readonly ActorType[] = ['OFFICER', 'SYSTEM'];
const NOTIFICATION_ACTORS: readonly ActorType[] = ['SYSTEM', 'INTEGRATION'];

interface Visible {
  appointment: AppointmentRow;
  slot: SlotRow;
}

function requireActor(ctx: TenantContext, allowed: readonly ActorType[]): void {
  if (!allowed.includes(ctx.actor.type)) {
    throw new Cmp056Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
  }
}

function unavailable(slot: SlotRow | undefined, now: Date): Cmp056Error {
  if (!slot) return new Cmp056Error('SF-SYS-002', detail('SLOT_NOT_FOUND'));
  return new Cmp056Error('SF-APP-001', detail(unavailableReason(slot, now)));
}

function sameSlotDefinition(a: SlotRow, b: SlotRow): boolean {
  return (
    a.appointment_type_ref === b.appointment_type_ref &&
    a.resource_calendar_ref === b.resource_calendar_ref &&
    a.jurisdiction_id === b.jurisdiction_id &&
    a.starts_at === b.starts_at &&
    a.ends_at === b.ends_at &&
    a.capacity === b.capacity
  );
}

/**
 * CMP-056 Scheduler & Appointment (INT-014). Every mutation is one short PostgreSQL transaction
 * that changes state, appends history, writes its domain outbox event and its audit event, and
 * completes the HTTP idempotency record. The only port (OPA PDP) is called with no transaction
 * open. Notifications are downstream consumers of the outbox (CMP-025); their failure is recorded
 * append-only and never changes a committed booking.
 */
export class SchedulerService {
  constructor(private readonly deps: SchedulerServiceDeps) {}

  private assertNoOpenTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private async guard(
    ctx: TenantContext,
    action: SchedulerAction,
    scope: ResourceScope,
  ): Promise<void> {
    this.assertNoOpenTx();
    await authorize(this.deps.authorizer, authzInput(ctx, action, scope));
  }

  private appointmentScope(v: Visible): ResourceScope {
    return {
      resourceType: 'Appointment',
      jurisdictionId: v.slot.jurisdiction_id,
      applicationId: v.appointment.application_id,
      ownerId: v.appointment.booked_by,
    };
  }

  private async inIdempotency(
    tx: SchedulerTx,
    ctx: TenantContext,
    idem: Idempotency,
    now: Date,
    fn: () => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const claim = await tx.claimIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      fingerprint: idem.fingerprint,
      now,
    });
    if (claim !== 'claimed') return claim;
    const result = await fn();
    await tx.completeIdempotency({
      principalId: ctx.actor.id,
      endpoint: idem.endpoint,
      key: idem.key,
      status: result.status,
      body: result.body,
    });
    return result;
  }

  /** Citizens only see appointments they booked; anything else is indistinguishable from absent. */
  private async loadVisible(ctx: TenantContext, appointmentId: string): Promise<Visible> {
    const found = await this.deps.repo.withTx(ctx, async (tx) => {
      const appointment = await tx.getAppointment(appointmentId);
      if (!appointment) return null;
      const slot = await tx.getSlotById(appointment.slot_id);
      return slot ? { appointment, slot } : null;
    });
    if (!found) throw new Cmp056Error('SF-SYS-002');
    if (ctx.actor.type === 'CITIZEN' && found.appointment.booked_by !== ctx.actor.id) {
      throw new Cmp056Error('SF-SYS-002');
    }
    return found;
  }

  private async loadSlot(ctx: TenantContext, slotRef: string): Promise<SlotRow> {
    const slot = await this.deps.repo.withTx(ctx, (tx) => tx.getSlotByRef(slotRef));
    if (!slot) throw new Cmp056Error('SF-SYS-002', detail('SLOT_NOT_FOUND'));
    return slot;
  }

  private async record(
    tx: SchedulerTx,
    ctx: TenantContext,
    p: {
      row: AppointmentRow;
      slot: SlotRow;
      from: LifecycleStatus | null;
      previousSlotRef: string | null;
      action: string;
      now: Date;
    },
  ): Promise<void> {
    const at = p.now.toISOString();
    await tx.insertHistory({
      tenant_id: ctx.tenant_id,
      appointment_event_id: randomUUID(),
      appointment_id: p.row.appointment_id,
      version: p.row.version,
      from_status: p.from,
      to_status: p.row.lifecycle_status,
      slot_ref: p.row.slot_ref,
      previous_slot_ref: p.previousSlotRef,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
      recorded_at: at,
    });
    await tx.insertOutbox(
      envelopeOf({
        eventType: EVENT_FOR_STATUS[p.row.lifecycle_status],
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: 'Appointment',
        aggregateId: p.row.appointment_id,
        aggregateVersion: p.row.version,
        occurredAt: at,
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: {
          appointment_id: p.row.appointment_id,
          appointment_type_ref: p.row.appointment_type_ref,
          lifecycle_status: p.row.lifecycle_status,
          previous_lifecycle_status: p.from,
          slot_ref: p.row.slot_ref,
          previous_slot_ref: p.previousSlotRef,
          resource_calendar_ref: p.row.resource_calendar_ref,
          application_id: p.row.application_id,
          jurisdiction_id: p.slot.jurisdiction_id,
          slot_starts_at: p.slot.starts_at,
          slot_ends_at: p.slot.ends_at,
          version: p.row.version,
          capacity_atomic: true,
          notification_failure_invalidates_booking: false,
          invented_statutory_policy_forbidden: true,
        },
      }),
      TOPIC_DOMAIN,
    );
    await appendAudit(tx, ctx, {
      action: p.action,
      actionClass: 'WRITE',
      resourceType: 'Appointment',
      resourceId: p.row.appointment_id,
      result: 'SUCCESS',
      now: p.now,
    });
  }

  /** Publishes one explicit slot from tenant metadata. Capacity is fixed at publication. */
  async publishSlot(ctx: TenantContext, input: SlotInput, idem: Idempotency): Promise<CommandResult> {
    requireActor(ctx, SLOT_PUBLISH_ACTORS);
    await this.guard(ctx, SCHEDULER_ACTIONS.publishSlot, {
      resourceType: 'AppointmentSlot',
      jurisdictionId: input.jurisdiction_id,
    });
    const now = this.deps.clock();
    if (Date.parse(input.starts_at) <= now.getTime()) {
      throw new Cmp056Error('SF-SYS-003', detail('SLOT_ALREADY_STARTED', '/starts_at'));
    }
    const at = now.toISOString();
    const row: SlotRow = {
      tenant_id: ctx.tenant_id,
      slot_id: randomUUID(),
      slot_ref: input.slot_ref,
      appointment_type_ref: input.appointment_type_ref,
      resource_calendar_ref: input.resource_calendar_ref,
      jurisdiction_id: input.jurisdiction_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      capacity: input.capacity,
      booked_count: 0,
      status: 'OPEN',
      actor_type: ctx.actor.type,
      created_by: ctx.actor.id,
      correlation_id: ctx.correlation_id,
      created_at: at,
      updated_at: at,
    };
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        if (!(await tx.insertSlot(row))) {
          const existing = await tx.getSlotByRef(input.slot_ref);
          if (existing && sameSlotDefinition(existing, row)) {
            return { status: 200, body: slotView(existing) };
          }
          throw new Cmp056Error('SF-APP-002', detail('SLOT_REF_CONFLICT'));
        }
        await appendAudit(tx, ctx, {
          action: 'APPOINTMENT_SLOT_PUBLISH',
          actionClass: 'WRITE',
          resourceType: 'AppointmentSlot',
          resourceId: row.slot_id,
          result: 'SUCCESS',
          now,
        });
        return { status: 201, body: slotView(row) };
      }),
    );
  }

  /** Bookable slots only: OPEN, not yet started, with a free seat. */
  async listSlots(ctx: TenantContext, q: SlotQuery): Promise<CommandResult> {
    await this.guard(ctx, SCHEDULER_ACTIONS.listSlots, { resourceType: 'AppointmentSlot' });
    const now = this.deps.clock().toISOString();
    const startsAfter = q.from !== null && Date.parse(q.from) > Date.parse(now) ? q.from : now;
    const slots = await this.deps.repo.withTx(ctx, (tx) =>
      tx.listBookableSlots({
        appointment_type_ref: q.appointment_type_ref,
        resource_calendar_ref: q.resource_calendar_ref,
        starts_after: startsAfter,
        starts_before: q.to,
        limit: q.limit,
      }),
    );
    return { status: 200, body: { slots: slots.map(slotView) } };
  }

  /**
   * Books one seat. The seat is taken by a single conditional UPDATE in the same transaction as
   * the appointment insert, so concurrent requests can never overbook a slot.
   */
  async book(ctx: TenantContext, input: BookInput, idem: Idempotency): Promise<CommandResult> {
    requireActor(ctx, BOOKING_ACTORS);
    const slot = await this.loadSlot(ctx, input.slot_ref);
    await this.guard(ctx, SCHEDULER_ACTIONS.book, {
      resourceType: 'Appointment',
      jurisdictionId: slot.jurisdiction_id,
      applicationId: input.application_id,
      ownerId: ctx.actor.id,
    });
    const now = this.deps.clock();
    const at = now.toISOString();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        const reserved = await tx.reserveSeat(slot.slot_id, at);
        if (!reserved) throw unavailable(await tx.getSlotById(slot.slot_id), now);
        const row: AppointmentRow = {
          tenant_id: ctx.tenant_id,
          appointment_id: randomUUID(),
          appointment_type_ref: reserved.appointment_type_ref,
          slot_id: reserved.slot_id,
          slot_ref: reserved.slot_ref,
          resource_calendar_ref: reserved.resource_calendar_ref,
          application_id: input.application_id,
          lifecycle_status: 'BOOKED',
          idempotency_key: idem.key,
          version: 1,
          correlation_id: ctx.correlation_id,
          actor_type: ctx.actor.type,
          booked_by: ctx.actor.id,
          booked_at: at,
          updated_at: at,
        };
        await tx.insertAppointment(row);
        await this.record(tx, ctx, {
          row,
          slot: reserved,
          from: null,
          previousSlotRef: null,
          action: 'APPOINTMENT_BOOK',
          now,
        });
        return { status: 201, body: appointmentView(row) };
      }),
    );
  }

  async get(ctx: TenantContext, appointmentId: string): Promise<CommandResult> {
    const visible = await this.loadVisible(ctx, appointmentId);
    await this.guard(ctx, SCHEDULER_ACTIONS.read, this.appointmentScope(visible));
    return { status: 200, body: appointmentView(visible.appointment) };
  }

  /** Moves the appointment to another slot of the same type: seat taken, then old seat freed. */
  async reschedule(
    ctx: TenantContext,
    appointmentId: string,
    input: RescheduleInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    requireActor(ctx, BOOKING_ACTORS);
    const visible = await this.loadVisible(ctx, appointmentId);
    const target = await this.loadSlot(ctx, input.slot_ref);
    await this.guard(ctx, SCHEDULER_ACTIONS.reschedule, this.appointmentScope(visible));
    await this.guard(ctx, SCHEDULER_ACTIONS.book, {
      resourceType: 'Appointment',
      jurisdictionId: target.jurisdiction_id,
      applicationId: visible.appointment.application_id,
      ownerId: visible.appointment.booked_by,
    });
    const now = this.deps.clock();
    const at = now.toISOString();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        const current = await tx.lockAppointment(appointmentId);
        if (!current) throw new Cmp056Error('SF-SYS-002');
        assertTransition(current.lifecycle_status, 'RESCHEDULED');
        if (target.slot_id === current.slot_id) {
          throw new Cmp056Error('SF-APP-001', detail('SAME_SLOT'));
        }
        if (target.appointment_type_ref !== current.appointment_type_ref) {
          throw new Cmp056Error('SF-APP-001', detail('APPOINTMENT_TYPE_MISMATCH'));
        }
        await tx.lockSlots([current.slot_id, target.slot_id]);
        const reserved = await tx.reserveSeat(target.slot_id, at);
        if (!reserved) throw unavailable(await tx.getSlotById(target.slot_id), now);
        if (!(await tx.releaseSeat(current.slot_id, at))) {
          throw new Cmp056Error('SF-SYS-001', detail('OCCUPANCY_INCONSISTENT'));
        }
        const next: AppointmentRow = {
          ...current,
          lifecycle_status: 'RESCHEDULED',
          slot_id: reserved.slot_id,
          slot_ref: reserved.slot_ref,
          resource_calendar_ref: reserved.resource_calendar_ref,
          version: current.version + 1,
          updated_at: at,
        };
        await this.patch(tx, current, next);
        await this.record(tx, ctx, {
          row: next,
          slot: reserved,
          from: current.lifecycle_status,
          previousSlotRef: current.slot_ref,
          action: 'APPOINTMENT_RESCHEDULE',
          now,
        });
        return { status: 200, body: appointmentView(next) };
      }),
    );
  }

  /** Cancels and returns the seat. No cancellation window is assumed; that is tenant policy. */
  async cancel(ctx: TenantContext, appointmentId: string, idem: Idempotency): Promise<CommandResult> {
    requireActor(ctx, BOOKING_ACTORS);
    const visible = await this.loadVisible(ctx, appointmentId);
    await this.guard(ctx, SCHEDULER_ACTIONS.cancel, this.appointmentScope(visible));
    const now = this.deps.clock();
    const at = now.toISOString();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        const current = await tx.lockAppointment(appointmentId);
        if (!current) throw new Cmp056Error('SF-SYS-002');
        assertTransition(current.lifecycle_status, 'CANCELLED');
        const [slot] = await tx.lockSlots([current.slot_id]);
        if (!slot || !(await tx.releaseSeat(current.slot_id, at))) {
          throw new Cmp056Error('SF-SYS-001', detail('OCCUPANCY_INCONSISTENT'));
        }
        const next: AppointmentRow = {
          ...current,
          lifecycle_status: 'CANCELLED',
          version: current.version + 1,
          updated_at: at,
        };
        await this.patch(tx, current, next);
        await this.record(tx, ctx, {
          row: next,
          slot,
          from: current.lifecycle_status,
          previousSlotRef: null,
          action: 'APPOINTMENT_CANCEL',
          now,
        });
        return { status: 200, body: appointmentView(next) };
      }),
    );
  }

  /** Records COMPLETED or NO_SHOW once the slot has started. The seat stays consumed. */
  async recordAttendance(
    ctx: TenantContext,
    appointmentId: string,
    input: AttendanceInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    requireActor(ctx, ATTENDANCE_ACTORS);
    const visible = await this.loadVisible(ctx, appointmentId);
    await this.guard(ctx, SCHEDULER_ACTIONS.recordAttendance, this.appointmentScope(visible));
    const now = this.deps.clock();
    const at = now.toISOString();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        const current = await tx.lockAppointment(appointmentId);
        if (!current) throw new Cmp056Error('SF-SYS-002');
        assertTransition(current.lifecycle_status, input.outcome);
        const slot = await tx.getSlotById(current.slot_id);
        if (!slot) throw new Cmp056Error('SF-SYS-001', detail('SLOT_MISSING'));
        if (now.getTime() < Date.parse(slot.starts_at)) {
          throw new Cmp056Error('SF-APP-001', detail('APPOINTMENT_NOT_STARTED'));
        }
        const next: AppointmentRow = {
          ...current,
          lifecycle_status: input.outcome,
          version: current.version + 1,
          updated_at: at,
        };
        await this.patch(tx, current, next);
        await this.record(tx, ctx, {
          row: next,
          slot,
          from: current.lifecycle_status,
          previousSlotRef: null,
          action: input.outcome === 'COMPLETED' ? 'APPOINTMENT_COMPLETE' : 'APPOINTMENT_NO_SHOW',
          now,
        });
        return { status: 200, body: appointmentView(next) };
      }),
    );
  }

  /**
   * Records a CMP-025 delivery outcome. The appointment row is never read for update or changed:
   * a FAILED notification leaves the committed booking exactly as it was.
   */
  async recordNotificationOutcome(
    ctx: TenantContext,
    appointmentId: string,
    input: NotificationInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    requireActor(ctx, NOTIFICATION_ACTORS);
    const visible = await this.loadVisible(ctx, appointmentId);
    await this.guard(ctx, SCHEDULER_ACTIONS.recordNotification, this.appointmentScope(visible));
    const now = this.deps.clock();
    return this.deps.repo.withTx(ctx, (tx) =>
      this.inIdempotency(tx, ctx, idem, now, async () => {
        const appointment = await tx.getAppointment(appointmentId);
        if (!appointment) throw new Cmp056Error('SF-SYS-002');
        const outcome: NotificationOutcomeRow = {
          tenant_id: ctx.tenant_id,
          outcome_id: randomUUID(),
          appointment_id: appointmentId,
          outcome: input.outcome,
          outcome_ref: input.outcome_ref,
          failure_code: input.failure_code,
          actor_type: ctx.actor.type,
          recorded_by: ctx.actor.id,
          correlation_id: ctx.correlation_id,
          recorded_at: now.toISOString(),
        };
        if (!(await tx.insertNotificationOutcome(outcome))) {
          const existing = await tx.findNotificationOutcome(appointmentId, input.outcome_ref);
          if (!existing) throw new Cmp056Error('SF-SYS-001', detail('OUTCOME_DEDUP_RACE'));
          if (existing.outcome !== input.outcome) {
            throw new Cmp056Error('SF-APP-002', detail('OUTCOME_CONFLICT'));
          }
          return {
            status: 200,
            body: notificationOutcomeView(existing, appointment.lifecycle_status),
          };
        }
        await appendAudit(tx, ctx, {
          action: 'APPOINTMENT_NOTIFICATION_OUTCOME_RECORD',
          actionClass: 'WRITE',
          resourceType: 'Appointment',
          resourceId: appointmentId,
          result: 'SUCCESS',
          now,
        });
        return {
          status: 201,
          body: notificationOutcomeView(outcome, appointment.lifecycle_status),
        };
      }),
    );
  }

  private async patch(tx: SchedulerTx, current: AppointmentRow, next: AppointmentRow): Promise<void> {
    const ok = await tx.updateAppointment(current.appointment_id, current.version, {
      lifecycle_status: next.lifecycle_status,
      slot_id: next.slot_id,
      slot_ref: next.slot_ref,
      resource_calendar_ref: next.resource_calendar_ref,
      version: next.version,
      updated_at: next.updated_at,
    });
    if (!ok) throw new Cmp056Error('SF-APP-002', detail('CONCURRENT_MODIFICATION'));
  }
}
