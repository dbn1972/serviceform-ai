import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import { authorize, authzInput, type AuthorizationPort } from '../authz.js';
import {
  APPOINTMENT_RESOURCE_TYPE,
  ACTIVE_STATUSES,
  appointmentView,
  canBook,
  canTransition,
  CAPACITY_ATOMIC,
  INVENTED_STATUTORY_POLICY_FORBIDDEN,
  NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
  SLOT_RESOURCE_TYPE,
  slotView,
  TYPE_RESOURCE_TYPE,
  type AppointmentRecord,
  type AppointmentTypeRecord,
  type LifecycleStatus,
  type SlotRecord,
} from '../domain/appointment.js';
import { collectionResourceId } from '../domain/ids.js';
import { Cmp056Error, detail, type ErrorCode } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { NotificationPort } from '../ports/notification.js';
import type { SchedulerRepository, SchedulerTx } from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type {
  BookAppointmentInput,
  PublishSlotInput,
  RegisterTypeInput,
  RescheduleInput,
  VersionedActionInput,
} from './input.js';

export interface SchedulerServiceDeps {
  repo: SchedulerRepository;
  authorizer: AuthorizationPort;
  notifier: NotificationPort;
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

type ActorType = TenantContext['actor']['type'];
const STAFF_ACTORS: readonly ActorType[] = ['OFFICER', 'PRIVILEGED_ADMIN', 'SYSTEM'];
const ADMIN_ACTORS: readonly ActorType[] = ['PRIVILEGED_ADMIN', 'SYSTEM'];
const BOOK_ACTORS: readonly ActorType[] = [
  'CITIZEN',
  'OFFICER',
  'PRIVILEGED_ADMIN',
  'SYSTEM',
  'INTEGRATION',
];

export const ACTIONS = {
  typeRegister: 'APPOINTMENT_TYPE_REGISTER',
  slotPublish: 'APPOINTMENT_SLOT_PUBLISH',
  slotList: 'APPOINTMENT_SLOT_LIST',
  book: 'APPOINTMENT_BOOK',
  read: 'APPOINTMENT_READ',
  reschedule: 'APPOINTMENT_RESCHEDULE',
  cancel: 'APPOINTMENT_CANCEL',
  complete: 'APPOINTMENT_COMPLETE',
  noShow: 'APPOINTMENT_NO_SHOW',
} as const;

class AuditedRefusal extends Cmp056Error {
  constructor(
    code: ErrorCode,
    readonly reason: string,
    readonly action: string,
    readonly resourceType: string,
    readonly resourceId: string,
  ) {
    super(code, detail(reason));
  }
}

export class AppointmentSchedulerService {
  constructor(private readonly deps: SchedulerServiceDeps) {}

  private assertNotInTx(): void {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp056Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
  }

  private assertActor(ctx: TenantContext, allowed: readonly ActorType[]): void {
    if (!allowed.includes(ctx.actor.type)) {
      throw new Cmp056Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  private async guard(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    actors: readonly ActorType[],
  ): Promise<void> {
    this.assertNotInTx();
    this.assertActor(ctx, actors);
    try {
      await authorize(this.deps.authorizer, authzInput(ctx, action, resourceType));
    } catch (err) {
      if (err instanceof Cmp056Error && err.code === 'SF-AUTH-002') {
        await this.auditOutcome(ctx, action, resourceType, resourceId, 'DENIED');
      }
      throw err;
    }
  }

  private async auditOutcome(
    ctx: TenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    result: 'DENIED' | 'FAILED',
    reason?: string,
  ): Promise<void> {
    const now = this.deps.clock();
    await this.deps.repo.withTx(ctx, (tx) =>
      appendAudit(tx, ctx, {
        action,
        actionClass: action.endsWith('_READ') || action.endsWith('_LIST') ? 'READ' : 'WRITE',
        resourceType,
        resourceId,
        result,
        ...(reason === undefined ? {} : { reason }),
        now,
      }),
    );
  }

  private async command(
    ctx: TenantContext,
    idem: Idempotency,
    run: (tx: SchedulerTx, now: Date) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    try {
      return await this.deps.repo.withTx(ctx, async (tx) => {
        const claim = await tx.claimIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          fingerprint: idem.fingerprint,
          now,
        });
        if (claim !== 'claimed') return claim;
        const result = await run(tx, now);
        await tx.completeIdempotency({
          principalId: ctx.actor.id,
          endpoint: idem.endpoint,
          key: idem.key,
          status: result.status,
          body: result.body,
        });
        return result;
      });
    } catch (err) {
      if (err instanceof AuditedRefusal) {
        await this.auditOutcome(
          ctx,
          err.action,
          err.resourceType,
          err.resourceId,
          'FAILED',
          err.reason,
        );
      }
      throw err;
    }
  }

  private async emit(
    tx: SchedulerTx,
    ctx: TenantContext,
    p: {
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      now: Date;
      data: object;
    },
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType: p.eventType,
        tenantId: ctx.tenant_id,
        cellId: ctx.cell_id,
        aggregateType: p.aggregateType,
        aggregateId: p.aggregateId,
        aggregateVersion: p.aggregateVersion,
        occurredAt: p.now.toISOString(),
        correlationId: ctx.correlation_id,
        actor: ctx.actor,
        data: p.data,
      }),
      TOPIC_DOMAIN,
    );
  }

  /**
   * Best-effort notify AFTER the booking transaction commits.
   * Failure updates notification_status only — never rolls back the booking
   * (notification_failure_invalidates_booking = false).
   */
  private async notifyAfterCommit(ctx: TenantContext, row: AppointmentRecord): Promise<void> {
    this.assertNotInTx();
    try {
      await this.deps.notifier.notifyAppointment({
        tenant_id: ctx.tenant_id,
        appointment_id: row.appointment_id,
        appointment_type_ref: row.appointment_type_ref,
        slot_ref: row.slot_ref,
        lifecycle_status: row.lifecycle_status,
        correlation_id: ctx.correlation_id,
      });
      await this.deps.repo.withTx(ctx, async (tx) => {
        const current = await tx.getAppointment(row.appointment_id, true);
        if (!current || current.appointment_version !== row.appointment_version) return;
        await tx.updateAppointment({
          ...current,
          notification_status: 'SENT',
          appointment_version: current.appointment_version + 1,
          updated_at: this.deps.clock().toISOString(),
          last_correlation_id: ctx.correlation_id,
        });
      });
    } catch {
      // Booking remains committed — only notification_status moves to FAILED.
      await this.deps.repo.withTx(ctx, async (tx) => {
        const current = await tx.getAppointment(row.appointment_id, true);
        if (!current) return;
        await tx.updateAppointment({
          ...current,
          notification_status: 'FAILED',
          appointment_version: current.appointment_version + 1,
          updated_at: this.deps.clock().toISOString(),
          last_correlation_id: ctx.correlation_id,
        });
      });
    }
  }

  async registerType(
    ctx: TenantContext,
    input: RegisterTypeInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'TYPES');
    await this.guard(ctx, ACTIONS.typeRegister, TYPE_RESOURCE_TYPE, collectionId, ADMIN_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      if (await tx.getTypeByRef(input.appointment_type_ref)) {
        throw new Cmp056Error('SF-APP-002', detail('TYPE_REF_EXISTS'));
      }
      const nowIso = now.toISOString();
      const row: AppointmentTypeRecord = {
        tenant_id: ctx.tenant_id,
        appointment_type_id: randomUUID(),
        appointment_type_ref: input.appointment_type_ref,
        resource_calendar_ref: input.resource_calendar_ref,
        created_at: nowIso,
        updated_at: nowIso,
        created_by: ctx.actor.id,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertType(row);
      await this.emit(tx, ctx, {
        eventType: 'AppointmentTypeRegistered',
        aggregateType: TYPE_RESOURCE_TYPE,
        aggregateId: row.appointment_type_id,
        aggregateVersion: 1,
        now,
        data: {
          appointment_type_id: row.appointment_type_id,
          appointment_type_ref: row.appointment_type_ref,
          invented_statutory_policy_forbidden: INVENTED_STATUTORY_POLICY_FORBIDDEN,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.typeRegister,
        actionClass: 'WRITE',
        resourceType: TYPE_RESOURCE_TYPE,
        resourceId: row.appointment_type_id,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 201,
        body: {
          appointment_type_id: row.appointment_type_id,
          appointment_type_ref: row.appointment_type_ref,
          resource_calendar_ref: row.resource_calendar_ref,
          invented_statutory_policy_forbidden: INVENTED_STATUTORY_POLICY_FORBIDDEN,
        },
      };
    });
  }

  async publishSlot(
    ctx: TenantContext,
    input: PublishSlotInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'SLOTS');
    await this.guard(ctx, ACTIONS.slotPublish, SLOT_RESOURCE_TYPE, collectionId, STAFF_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const type = await tx.getType(input.appointment_type_id);
      if (!type) throw new Cmp056Error('SF-SYS-002', detail('TYPE_NOT_FOUND'));
      if (await tx.getSlotByRef(input.slot_ref)) {
        throw new Cmp056Error('SF-APP-002', detail('SLOT_REF_EXISTS'));
      }
      const nowIso = now.toISOString();
      const row: SlotRecord = {
        tenant_id: ctx.tenant_id,
        slot_id: randomUUID(),
        slot_ref: input.slot_ref,
        appointment_type_id: type.appointment_type_id,
        capacity: input.capacity,
        booked_count: 0,
        opens_at: input.opens_at,
        closes_at: input.closes_at,
        created_at: nowIso,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertSlot(row);
      await this.emit(tx, ctx, {
        eventType: 'AppointmentSlotPublished',
        aggregateType: SLOT_RESOURCE_TYPE,
        aggregateId: row.slot_id,
        aggregateVersion: 1,
        now,
        data: {
          slot_id: row.slot_id,
          slot_ref: row.slot_ref,
          capacity: row.capacity,
          capacity_atomic: CAPACITY_ATOMIC,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.slotPublish,
        actionClass: 'WRITE',
        resourceType: SLOT_RESOURCE_TYPE,
        resourceId: row.slot_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: slotView(row) };
    });
  }

  async listSlots(
    ctx: TenantContext,
    appointmentTypeId: string | undefined,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'SLOTS');
    await this.guard(ctx, ACTIONS.slotList, SLOT_RESOURCE_TYPE, collectionId, BOOK_ACTORS);
    const now = this.deps.clock();
    const slots = await this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.listAvailableSlots(appointmentTypeId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.slotList,
        actionClass: 'READ',
        resourceType: SLOT_RESOURCE_TYPE,
        resourceId: collectionId,
        result: 'SUCCESS',
        now,
      });
      return rows;
    });
    return { status: 200, body: { slots: slots.map(slotView), capacity_atomic: CAPACITY_ATOMIC } };
  }

  async book(
    ctx: TenantContext,
    input: BookAppointmentInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    const collectionId = collectionResourceId(ctx.tenant_id, 'APPOINTMENTS');
    await this.guard(ctx, ACTIONS.book, APPOINTMENT_RESOURCE_TYPE, collectionId, BOOK_ACTORS);
    const result = await this.command(ctx, idem, async (tx, now) => {
      const slot = await tx.getSlotByRef(input.slot_ref, true);
      if (!slot) throw new Cmp056Error('SF-SYS-002', detail('SLOT_NOT_FOUND'));
      if (!canBook(slot)) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'SLOT_FULL',
          ACTIONS.book,
          SLOT_RESOURCE_TYPE,
          slot.slot_id,
        );
      }
      const type = await tx.getType(slot.appointment_type_id);
      if (!type) throw new Cmp056Error('SF-SYS-002', detail('TYPE_NOT_FOUND'));
      const nowIso = now.toISOString();
      const row: AppointmentRecord = {
        tenant_id: ctx.tenant_id,
        appointment_id: randomUUID(),
        appointment_type_id: type.appointment_type_id,
        appointment_type_ref: type.appointment_type_ref,
        slot_id: slot.slot_id,
        slot_ref: slot.slot_ref,
        resource_calendar_ref: type.resource_calendar_ref,
        lifecycle_status: 'BOOKED',
        appointment_version: 1,
        participant_ref: input.participant_ref,
        notification_status: 'PENDING',
        created_at: nowIso,
        updated_at: nowIso,
        created_by: ctx.actor.id,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.insertAppointment(row);
      await tx.updateSlotBooked({
        ...slot,
        booked_count: slot.booked_count + 1,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      });
      await tx.insertEventLog({
        tenant_id: ctx.tenant_id,
        event_log_id: randomUUID(),
        appointment_id: row.appointment_id,
        from_status: null,
        to_status: 'BOOKED',
        from_slot_ref: null,
        to_slot_ref: row.slot_ref,
        appointment_version: 1,
        actor_id: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        occurred_at: nowIso,
      });
      await this.emit(tx, ctx, {
        eventType: 'AppointmentBooked',
        aggregateType: APPOINTMENT_RESOURCE_TYPE,
        aggregateId: row.appointment_id,
        aggregateVersion: 1,
        now,
        data: {
          appointment_id: row.appointment_id,
          appointment_type_ref: row.appointment_type_ref,
          slot_ref: row.slot_ref,
          lifecycle_status: 'BOOKED',
          capacity_atomic: CAPACITY_ATOMIC,
          notification_failure_invalidates_booking: NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
          invented_statutory_policy_forbidden: INVENTED_STATUTORY_POLICY_FORBIDDEN,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.book,
        actionClass: 'WRITE',
        resourceType: APPOINTMENT_RESOURCE_TYPE,
        resourceId: row.appointment_id,
        result: 'SUCCESS',
        now,
      });
      return { status: 201, body: appointmentView(row, idem.key) };
    });

    if (result.status === 201) {
      const body = result.body as { appointment: { appointment_id: string } };
      const booked = await this.deps.repo.withTx(ctx, (tx) =>
        tx.getAppointment(body.appointment.appointment_id),
      );
      if (booked) await this.notifyAfterCommit(ctx, booked);
      const refreshed = await this.deps.repo.withTx(ctx, (tx) =>
        tx.getAppointment(body.appointment.appointment_id),
      );
      if (refreshed) {
        return { status: 201, body: appointmentView(refreshed, idem.key) };
      }
    }
    return result;
  }

  async getAppointment(ctx: TenantContext, appointmentId: string): Promise<CommandResult> {
    await this.guard(ctx, ACTIONS.read, APPOINTMENT_RESOURCE_TYPE, appointmentId, BOOK_ACTORS);
    const now = this.deps.clock();
    const row = await this.deps.repo.withTx(ctx, async (tx) => {
      const found = await tx.getAppointment(appointmentId);
      await appendAudit(tx, ctx, {
        action: ACTIONS.read,
        actionClass: 'READ',
        resourceType: APPOINTMENT_RESOURCE_TYPE,
        resourceId: appointmentId,
        result: found ? 'SUCCESS' : 'FAILED',
        ...(found ? {} : { reason: 'APPOINTMENT_NOT_FOUND' }),
        now,
      });
      return found;
    });
    if (!row) throw new Cmp056Error('SF-SYS-002', detail('APPOINTMENT_NOT_FOUND'));
    return { status: 200, body: appointmentView(row) };
  }

  async reschedule(
    ctx: TenantContext,
    appointmentId: string,
    input: RescheduleInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    await this.guard(
      ctx,
      ACTIONS.reschedule,
      APPOINTMENT_RESOURCE_TYPE,
      appointmentId,
      BOOK_ACTORS,
    );
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getAppointment(appointmentId, true);
      if (!current) throw new Cmp056Error('SF-SYS-002', detail('APPOINTMENT_NOT_FOUND'));
      if (current.appointment_version !== input.expected_version) {
        throw new Cmp056Error('SF-APP-001', detail('STALE_VERSION', '/expected_version'));
      }
      const verdict = canTransition(current.lifecycle_status, 'RESCHEDULED');
      if (!verdict.allowed) {
        throw new AuditedRefusal(
          'SF-APP-001',
          verdict.reason ?? 'TRANSITION_NOT_PERMITTED',
          ACTIONS.reschedule,
          APPOINTMENT_RESOURCE_TYPE,
          appointmentId,
        );
      }
      if (current.slot_ref === input.slot_ref) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'SAME_SLOT',
          ACTIONS.reschedule,
          APPOINTMENT_RESOURCE_TYPE,
          appointmentId,
        );
      }
      const oldSlot = await tx.getSlot(current.slot_id, true);
      const newSlot = await tx.getSlotByRef(input.slot_ref, true);
      if (!oldSlot || !newSlot) throw new Cmp056Error('SF-SYS-002', detail('SLOT_NOT_FOUND'));
      if (newSlot.appointment_type_id !== current.appointment_type_id) {
        throw new Cmp056Error('SF-SYS-003', detail('TYPE_MISMATCH', '/slot_ref'));
      }
      if (!canBook(newSlot)) {
        throw new AuditedRefusal(
          'SF-APP-001',
          'SLOT_FULL',
          ACTIONS.reschedule,
          SLOT_RESOURCE_TYPE,
          newSlot.slot_id,
        );
      }
      const nowIso = now.toISOString();
      await tx.updateSlotBooked({
        ...oldSlot,
        booked_count: oldSlot.booked_count - 1,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      });
      await tx.updateSlotBooked({
        ...newSlot,
        booked_count: newSlot.booked_count + 1,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      });
      const next: AppointmentRecord = {
        ...current,
        slot_id: newSlot.slot_id,
        slot_ref: newSlot.slot_ref,
        lifecycle_status: 'RESCHEDULED',
        appointment_version: current.appointment_version + 1,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateAppointment(next);
      await tx.insertEventLog({
        tenant_id: ctx.tenant_id,
        event_log_id: randomUUID(),
        appointment_id: appointmentId,
        from_status: current.lifecycle_status,
        to_status: 'RESCHEDULED',
        from_slot_ref: current.slot_ref,
        to_slot_ref: next.slot_ref,
        appointment_version: next.appointment_version,
        actor_id: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        occurred_at: nowIso,
      });
      await this.emit(tx, ctx, {
        eventType: 'AppointmentRescheduled',
        aggregateType: APPOINTMENT_RESOURCE_TYPE,
        aggregateId: appointmentId,
        aggregateVersion: next.appointment_version,
        now,
        data: {
          appointment_id: appointmentId,
          from_slot_ref: current.slot_ref,
          to_slot_ref: next.slot_ref,
          lifecycle_status: 'RESCHEDULED',
          capacity_atomic: CAPACITY_ATOMIC,
          notification_failure_invalidates_booking: NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
        },
      });
      await appendAudit(tx, ctx, {
        action: ACTIONS.reschedule,
        actionClass: 'WRITE',
        resourceType: APPOINTMENT_RESOURCE_TYPE,
        resourceId: appointmentId,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: appointmentView(next, idem.key) };
    });
  }

  private async terminalTransition(
    ctx: TenantContext,
    appointmentId: string,
    input: VersionedActionInput,
    idem: Idempotency,
    to: Extract<LifecycleStatus, 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'>,
    action: string,
    eventType: DomainEventType,
  ): Promise<CommandResult> {
    await this.guard(ctx, action, APPOINTMENT_RESOURCE_TYPE, appointmentId, BOOK_ACTORS);
    return this.command(ctx, idem, async (tx, now) => {
      const current = await tx.getAppointment(appointmentId, true);
      if (!current) throw new Cmp056Error('SF-SYS-002', detail('APPOINTMENT_NOT_FOUND'));
      if (current.appointment_version !== input.expected_version) {
        throw new Cmp056Error('SF-APP-001', detail('STALE_VERSION', '/expected_version'));
      }
      const verdict = canTransition(current.lifecycle_status, to);
      if (!verdict.allowed) {
        throw new AuditedRefusal(
          'SF-APP-001',
          verdict.reason ?? 'TRANSITION_NOT_PERMITTED',
          action,
          APPOINTMENT_RESOURCE_TYPE,
          appointmentId,
        );
      }
      const nowIso = now.toISOString();
      if (ACTIVE_STATUSES.has(current.lifecycle_status)) {
        const slot = await tx.getSlot(current.slot_id, true);
        if (slot) {
          await tx.updateSlotBooked({
            ...slot,
            booked_count: Math.max(0, slot.booked_count - 1),
            updated_at: nowIso,
            last_correlation_id: ctx.correlation_id,
          });
        }
      }
      const next: AppointmentRecord = {
        ...current,
        lifecycle_status: to,
        appointment_version: current.appointment_version + 1,
        updated_at: nowIso,
        last_correlation_id: ctx.correlation_id,
      };
      await tx.updateAppointment(next);
      await tx.insertEventLog({
        tenant_id: ctx.tenant_id,
        event_log_id: randomUUID(),
        appointment_id: appointmentId,
        from_status: current.lifecycle_status,
        to_status: to,
        from_slot_ref: current.slot_ref,
        to_slot_ref: current.slot_ref,
        appointment_version: next.appointment_version,
        actor_id: ctx.actor.id,
        correlation_id: ctx.correlation_id,
        occurred_at: nowIso,
      });
      await this.emit(tx, ctx, {
        eventType,
        aggregateType: APPOINTMENT_RESOURCE_TYPE,
        aggregateId: appointmentId,
        aggregateVersion: next.appointment_version,
        now,
        data: {
          appointment_id: appointmentId,
          slot_ref: current.slot_ref,
          lifecycle_status: to,
          capacity_atomic: CAPACITY_ATOMIC,
          notification_failure_invalidates_booking: NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
        },
      });
      await appendAudit(tx, ctx, {
        action,
        actionClass: 'WRITE',
        resourceType: APPOINTMENT_RESOURCE_TYPE,
        resourceId: appointmentId,
        result: 'SUCCESS',
        now,
      });
      return { status: 200, body: appointmentView(next, idem.key) };
    });
  }

  cancel(
    ctx: TenantContext,
    appointmentId: string,
    input: VersionedActionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    return this.terminalTransition(
      ctx,
      appointmentId,
      input,
      idem,
      'CANCELLED',
      ACTIONS.cancel,
      'AppointmentCancelled',
    );
  }

  complete(
    ctx: TenantContext,
    appointmentId: string,
    input: VersionedActionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    return this.terminalTransition(
      ctx,
      appointmentId,
      input,
      idem,
      'COMPLETED',
      ACTIONS.complete,
      'AppointmentCompleted',
    );
  }

  noShow(
    ctx: TenantContext,
    appointmentId: string,
    input: VersionedActionInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    return this.terminalTransition(
      ctx,
      appointmentId,
      input,
      idem,
      'NO_SHOW',
      ACTIONS.noShow,
      'AppointmentNoShow',
    );
  }
}
