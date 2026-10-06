import { randomUUID } from 'node:crypto';
import { appendAudit } from '../audit.js';
import {
  authorize,
  authzInput,
  DEFICIENCY_ACTIONS,
  type AuthorizationPort,
  type DeficiencyAction,
} from '../authz.js';
import { nextStatus } from '../domain/model.js';
import { Cmp019Error, detail } from '../errors.js';
import { envelopeOf, TOPIC_DOMAIN, type DomainEventType } from '../outbox.js';
import type { CaseCommandPort } from '../ports/case-command-port.js';
import type { NotificationPort, DeficiencyNotificationRequest } from '../ports/notification-port.js';
import type { SlaClockPort } from '../ports/sla-clock-port.js';
import type {
  DeficiencyRepository,
  DeficiencyTx,
  EvidenceRow,
  HistoryRow,
  ItemRow,
  NoticeRow,
} from '../repo/types.js';
import type { TenantContext } from '../types.js';
import type { CloseInput, OpenInput, RespondInput } from './input.js';

export interface DeficiencyServiceDeps {
  repo: DeficiencyRepository;
  authorizer: AuthorizationPort;
  slaClock: SlaClockPort;
  caseCommands: CaseCommandPort;
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

interface PortWork {
  caseCommand?: {
    applicationId: string;
    body: Parameters<CaseCommandPort['executeCommand']>[2];
    idempotencyKey: string;
  };
  sla?: { kind: 'pause' | 'resume'; applicationId: string; stage: string; reason: string; key: string };
  notification?: DeficiencyNotificationRequest;
}

interface Committed {
  status: number;
  body: unknown;
  work: PortWork;
  replayed: boolean;
}

const EVENT_BY_OP: Record<'OPEN' | 'RESPOND' | 'CLOSE', DomainEventType> = {
  OPEN: 'DeficiencyOpened',
  RESPOND: 'DeficiencyResponded',
  CLOSE: 'DeficiencyClosed',
};

const NOTIFY_BY_OP: Record<'OPEN' | 'RESPOND' | 'CLOSE', DeficiencyNotificationRequest['kind']> = {
  OPEN: 'DEFICIENCY_OPENED',
  RESPOND: 'DEFICIENCY_RESPONDED',
  CLOSE: 'DEFICIENCY_CLOSED',
};

export function noticeView(row: NoticeRow, items: ItemRow[], evidence: EvidenceRow[]): Record<string, unknown> {
  return {
    deficiency_id: row.deficiency_id,
    application_id: row.application_id,
    status: row.status,
    reason_code: row.reason_code,
    notice_code: row.notice_code,
    instruction_ref: row.instruction_ref,
    sla_pause_reason_code: row.sla_pause_reason_code,
    sla_stage_code: row.sla_stage_code,
    response_due_at: row.response_due_at,
    opened_at: row.opened_at,
    responded_at: row.responded_at,
    closed_at: row.closed_at,
    close_reason_code: row.close_reason_code,
    aggregate_version: row.aggregate_version,
    notification_port: 'M06_CMP025',
    items: items.map((i) => ({
      item_seq: i.item_seq,
      item_code: i.item_code,
      evidence_requirement_ref: i.evidence_requirement_ref,
      required: i.required,
      item_status: i.item_status,
    })),
    evidence: evidence.map((e) => ({
      evidence_ref: e.evidence_ref,
      kind_code: e.kind_code,
      response_id: e.response_id,
    })),
  };
}

export class DeficiencyService {
  constructor(private readonly deps: DeficiencyServiceDeps) {}

  private async guard(
    ctx: TenantContext,
    action: DeficiencyAction,
    applicationId?: string,
  ): Promise<void> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    await authorize(this.deps.authorizer, authzInput(ctx, action, applicationId));
  }

  private assertActor(ctx: TenantContext, allowed: TenantContext['actor']['type'][]): void {
    if (!allowed.includes(ctx.actor.type)) {
      throw new Cmp019Error('SF-AUTH-002', detail('ACTOR_NOT_PERMITTED'));
    }
  }

  private async idempotent(
    ctx: TenantContext,
    idem: Idempotency,
    fn: (tx: DeficiencyTx, now: Date) => Promise<{ status: number; body: unknown; work: PortWork }>,
  ): Promise<CommandResult> {
    const now = this.deps.clock();
    const outcome = await this.deps.repo.withTx(ctx, async (tx): Promise<Committed> => {
      const claim = await tx.claimIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        fingerprint: idem.fingerprint,
        now,
      });
      if (claim !== 'claimed') return { ...claim, work: {}, replayed: true };
      const result = await fn(tx, now);
      await tx.completeIdempotency({
        principalId: ctx.actor.id,
        endpoint: idem.endpoint,
        key: idem.key,
        status: result.status,
        body: result.body,
      });
      return { ...result, replayed: false };
    });
    if (!outcome.replayed) await this.afterCommit(ctx, outcome.work);
    return { status: outcome.status, body: outcome.body };
  }

  /** Ports run after commit. Failures never undo the deficiency row (Constitution #11). */
  private async afterCommit(ctx: TenantContext, work: PortWork): Promise<void> {
    if (this.deps.repo.inTransaction()) {
      throw new Cmp019Error('SF-SYS-001', { details: [{ code: 'NETWORK_IN_TX' }] });
    }
    if (work.caseCommand) {
      try {
        await this.deps.caseCommands.executeCommand(
          ctx,
          work.caseCommand.applicationId,
          work.caseCommand.body,
          work.caseCommand.idempotencyKey,
        );
      } catch {
        // CMP-015 remains the case owner; stitch retries from the outbox event.
      }
    }
    if (work.sla) {
      const command = {
        application_id: work.sla.applicationId,
        stage_code: work.sla.stage,
        reason_code: work.sla.reason,
        idempotency_key: work.sla.key,
      };
      try {
        if (work.sla.kind === 'pause') await this.deps.slaClock.pauseForDeficiency(ctx, command);
        else await this.deps.slaClock.resumeAfterDeficiency(ctx, command);
      } catch {
        // INT-009 retry is owned by STITCH-B / outbox consumers, not by rolling back CMP-019.
      }
    }
    if (work.notification) {
      try {
        await this.deps.notifier.requestNotification(work.notification);
      } catch {
        // CMP-025 delivery is not this service's job.
      }
    }
  }

  private async emit(
    tx: DeficiencyTx,
    ctx: TenantContext,
    row: NoticeRow,
    eventType: DomainEventType,
    operation: 'OPEN' | 'RESPOND' | 'CLOSE',
  ): Promise<string> {
    const env = envelopeOf({
      eventType,
      tenantId: ctx.tenant_id,
      cellId: ctx.cell_id,
      aggregateType: 'DeficiencyNotice',
      aggregateId: row.deficiency_id,
      aggregateVersion: row.aggregate_version,
      occurredAt: row.updated_at,
      correlationId: ctx.correlation_id,
      actor: ctx.actor,
      data: {
        deficiency_id: row.deficiency_id,
        application_id: row.application_id,
        status: row.status,
        operation,
        reason_code: row.reason_code,
        notice_code: row.notice_code,
        sla_pause_reason_code: row.sla_pause_reason_code,
        response_due_at: row.response_due_at,
        notification_port: 'M06_CMP025',
      },
    });
    await tx.insertOutbox(env, TOPIC_DOMAIN);
    return env.event_id;
  }

  private history(
    ctx: TenantContext,
    row: NoticeRow,
    seq: number,
    operation: 'OPEN' | 'RESPOND' | 'CLOSE',
    from: NoticeRow['status'] | null,
    occurredAt: string,
    reason: string | null,
  ): HistoryRow {
    return {
      deficiency_id: row.deficiency_id,
      sequence_no: seq,
      operation,
      from_status: from,
      to_status: row.status,
      occurred_at: occurredAt,
      reason_code: reason,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      correlation_id: ctx.correlation_id,
    };
  }

  async open(ctx: TenantContext, input: OpenInput, idem: Idempotency): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER']);
    await this.guard(ctx, DEFICIENCY_ACTIONS.open, input.application_id);
    if (input.response_due_at !== null && Date.parse(input.response_due_at) <= this.deps.clock().getTime()) {
      throw new Cmp019Error('SF-SYS-003', detail('DUE_AT_NOT_FUTURE', '/response_due_at'));
    }
    return this.idempotent(ctx, idem, async (tx, now) => {
      if (await tx.findActiveByApplication(input.application_id)) {
        throw new Cmp019Error('SF-APP-002', detail('ACTIVE_DEFICIENCY_EXISTS'));
      }
      const nowIso = now.toISOString();
      const row: NoticeRow = {
        tenant_id: ctx.tenant_id,
        deficiency_id: randomUUID(),
        application_id: input.application_id,
        cell_id: ctx.cell_id,
        status: 'OPEN',
        reason_code: input.reason_code,
        notice_code: input.notice_code,
        instruction_ref: input.instruction_ref,
        sla_pause_reason_code: input.sla_pause_reason_code,
        sla_stage_code: input.sla_stage_code,
        response_due_at: input.response_due_at,
        opened_at: nowIso,
        responded_at: null,
        closed_at: null,
        close_reason_code: null,
        opened_by: ctx.actor.id,
        closed_by: null,
        correlation_id: ctx.correlation_id,
        aggregate_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await tx.insertNotice(row);
      const items: ItemRow[] = input.items.map((item, i) => ({
        deficiency_id: row.deficiency_id,
        item_seq: i + 1,
        item_code: item.item_code,
        evidence_requirement_ref: item.evidence_requirement_ref,
        required: item.required,
        item_status: 'REQUESTED',
      }));
      for (const item of items) await tx.insertItem(item);
      const evidence: EvidenceRow[] = input.evidence.map((e) => ({
        link_id: randomUUID(),
        deficiency_id: row.deficiency_id,
        response_id: null,
        evidence_ref: e.evidence_ref,
        kind_code: e.kind_code,
        attached_by: ctx.actor.id,
        attached_at: nowIso,
      }));
      for (const e of evidence) await tx.insertEvidence(e);
      await tx.appendHistory(this.history(ctx, row, 1, 'OPEN', null, nowIso, row.reason_code));
      const eventId = await this.emit(tx, ctx, row, EVENT_BY_OP.OPEN, 'OPEN');
      await appendAudit(tx, ctx, {
        action: 'DEFICIENCY_OPEN',
        actionClass: 'WRITE',
        resourceType: 'DeficiencyNotice',
        resourceId: row.deficiency_id,
        result: 'SUCCESS',
        now,
      });
      return {
        status: 201,
        body: noticeView(row, items, evidence),
        work: {
          caseCommand: {
            applicationId: row.application_id,
            body: {
              command: 'RAISE_DEFICIENCY',
              expected_state: input.case_expected_state,
              expected_version: input.case_expected_version,
              reason_code: row.reason_code,
            },
            idempotencyKey: idem.key,
          },
          sla: {
            kind: 'pause',
            applicationId: row.application_id,
            stage: row.sla_stage_code,
            reason: row.sla_pause_reason_code,
            key: `int009-pause:${row.deficiency_id}`,
          },
          notification: {
            notification_port: 'M06_CMP025',
            tenant_id: ctx.tenant_id,
            application_id: row.application_id,
            deficiency_id: row.deficiency_id,
            kind: NOTIFY_BY_OP.OPEN,
            source_event_id: eventId,
          },
        },
      };
    });
  }

  async respond(
    ctx: TenantContext,
    deficiencyId: string,
    input: RespondInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    this.assertActor(ctx, ['CITIZEN']);
    await this.guard(ctx, DEFICIENCY_ACTIONS.respond);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const existing = await tx.getNotice(deficiencyId);
      if (!existing) throw new Cmp019Error('SF-SYS-002');
      if (nextStatus(existing.status, 'RESPOND') !== 'RESPONSE_RECEIVED') {
        throw new Cmp019Error('SF-APP-001', detail('ILLEGAL_TRANSITION'));
      }
      const items = await tx.listItems(deficiencyId);
      const known = new Set(items.map((i) => i.item_code));
      for (const code of input.provided_item_codes) {
        if (!known.has(code)) throw new Cmp019Error('SF-SYS-003', detail('UNKNOWN_ITEM', '/provided_item_codes'));
      }
      const nowIso = now.toISOString();
      const row: NoticeRow = {
        ...existing,
        status: 'RESPONSE_RECEIVED',
        responded_at: nowIso,
        aggregate_version: existing.aggregate_version + 1,
        updated_at: nowIso,
      };
      await tx.updateNotice(row);
      await tx.markItemsProvided(deficiencyId, input.provided_item_codes);
      const responseId = randomUUID();
      await tx.insertResponse({
        response_id: responseId,
        deficiency_id: deficiencyId,
        narrative_ref: input.narrative_ref,
        responded_at: nowIso,
        actor_id: ctx.actor.id,
        correlation_id: ctx.correlation_id,
      });
      const evidence: EvidenceRow[] = input.evidence.map((e) => ({
        link_id: randomUUID(),
        deficiency_id: deficiencyId,
        response_id: responseId,
        evidence_ref: e.evidence_ref,
        kind_code: e.kind_code,
        attached_by: ctx.actor.id,
        attached_at: nowIso,
      }));
      for (const e of evidence) await tx.insertEvidence(e);
      await tx.appendHistory(
        this.history(ctx, row, existing.aggregate_version + 1, 'RESPOND', existing.status, nowIso, null),
      );
      const eventId = await this.emit(tx, ctx, row, EVENT_BY_OP.RESPOND, 'RESPOND');
      await appendAudit(tx, ctx, {
        action: 'DEFICIENCY_RESPOND',
        actionClass: 'WRITE',
        resourceType: 'DeficiencyNotice',
        resourceId: deficiencyId,
        result: 'SUCCESS',
        now,
      });
      const allItems = await tx.listItems(deficiencyId);
      const allEvidence = await tx.listEvidence(deficiencyId);
      return {
        status: 200,
        body: noticeView(row, allItems, allEvidence),
        work: {
          caseCommand: {
            applicationId: row.application_id,
            body: {
              command: 'RECORD_CITIZEN_RESPONSE',
              expected_state: input.case_expected_state,
              expected_version: input.case_expected_version,
              reason_code: null,
            },
            idempotencyKey: idem.key,
          },
          sla: {
            kind: 'resume',
            applicationId: row.application_id,
            stage: row.sla_stage_code,
            reason: row.sla_pause_reason_code,
            key: `int009-resume:${row.deficiency_id}`,
          },
          notification: {
            notification_port: 'M06_CMP025',
            tenant_id: ctx.tenant_id,
            application_id: row.application_id,
            deficiency_id: row.deficiency_id,
            kind: NOTIFY_BY_OP.RESPOND,
            source_event_id: eventId,
          },
        },
      };
    });
  }

  async close(
    ctx: TenantContext,
    deficiencyId: string,
    input: CloseInput,
    idem: Idempotency,
  ): Promise<CommandResult> {
    this.assertActor(ctx, ['OFFICER']);
    await this.guard(ctx, DEFICIENCY_ACTIONS.close);
    return this.idempotent(ctx, idem, async (tx, now) => {
      const existing = await tx.getNotice(deficiencyId);
      if (!existing) throw new Cmp019Error('SF-SYS-002');
      if (nextStatus(existing.status, 'CLOSE') !== 'CLOSED') {
        throw new Cmp019Error('SF-APP-001', detail('ILLEGAL_TRANSITION'));
      }
      const nowIso = now.toISOString();
      const row: NoticeRow = {
        ...existing,
        status: 'CLOSED',
        closed_at: nowIso,
        closed_by: ctx.actor.id,
        close_reason_code: input.close_reason_code,
        aggregate_version: existing.aggregate_version + 1,
        updated_at: nowIso,
      };
      await tx.updateNotice(row);
      await tx.appendHistory(
        this.history(
          ctx,
          row,
          existing.aggregate_version + 1,
          'CLOSE',
          existing.status,
          nowIso,
          input.close_reason_code,
        ),
      );
      const eventId = await this.emit(tx, ctx, row, EVENT_BY_OP.CLOSE, 'CLOSE');
      await appendAudit(tx, ctx, {
        action: 'DEFICIENCY_CLOSE',
        actionClass: 'WRITE',
        resourceType: 'DeficiencyNotice',
        resourceId: deficiencyId,
        result: 'SUCCESS',
        now,
      });
      const items = await tx.listItems(deficiencyId);
      const evidence = await tx.listEvidence(deficiencyId);
      const resume = existing.status === 'OPEN';
      return {
        status: 200,
        body: noticeView(row, items, evidence),
        work: {
          ...(resume
            ? {
                sla: {
                  kind: 'resume' as const,
                  applicationId: row.application_id,
                  stage: row.sla_stage_code,
                  reason: row.sla_pause_reason_code,
                  key: `int009-resume:${row.deficiency_id}`,
                },
              }
            : {}),
          notification: {
            notification_port: 'M06_CMP025',
            tenant_id: ctx.tenant_id,
            application_id: row.application_id,
            deficiency_id: row.deficiency_id,
            kind: NOTIFY_BY_OP.CLOSE,
            source_event_id: eventId,
          },
        },
      };
    });
  }

  async get(ctx: TenantContext, deficiencyId: string): Promise<CommandResult> {
    await this.guard(ctx, DEFICIENCY_ACTIONS.read);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const row = await tx.getNotice(deficiencyId);
      if (!row) throw new Cmp019Error('SF-SYS-002');
      const items = await tx.listItems(deficiencyId);
      const evidence = await tx.listEvidence(deficiencyId);
      return { status: 200, body: noticeView(row, items, evidence) };
    });
  }

  async listForApplication(ctx: TenantContext, applicationId: string): Promise<CommandResult> {
    await this.guard(ctx, DEFICIENCY_ACTIONS.read, applicationId);
    return this.deps.repo.withTx(ctx, async (tx) => {
      const rows = await tx.listByApplication(applicationId);
      const body = [];
      for (const row of rows) {
        body.push(
          noticeView(row, await tx.listItems(row.deficiency_id), await tx.listEvidence(row.deficiency_id)),
        );
      }
      return { status: 200, body: { deficiencies: body } };
    });
  }
}
