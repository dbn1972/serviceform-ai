import { randomUUID } from 'node:crypto';
import { authorizeAction, type AuthzOutcome, type ResourceAttributes } from './authz.js';
import { assertPortAllowed, loadConfig, type Cmp026Config } from './config.js';
import { requireTenantContext } from './context.js';
import {
  assertNoticeSenderIsAuthority,
  assertThreadAcceptsMessages,
  bodyDigest,
  isMessageKind,
  isThreadCommand,
  isThreadStatus,
  MAX_PARTICIPANTS_PER_THREAD,
  parseBody,
  parsePageSize,
  parseParticipant,
  parseSequence,
  parseStorageKeys,
  participantRef,
  planThreadTransition,
  type MessageKind,
  type ParticipantInput,
  type ThreadCommand,
} from './domain/model.js';
import {
  IDEMPOTENCY_KEY_RE,
  isCode,
  isIsoTimestamp,
  isPlainObject,
  isUuid,
  sha256Of,
  type TenantRequestContext,
} from './domain/validate.js';
import { Cmp026Error, detail } from './errors.js';
import { auditEnvelope, envelopeOf, EVENT_TYPES, TOPIC_AUDIT, TOPIC_DOMAIN } from './events.js';
import type { AuthorizationPort } from './ports/authorization.js';
import {
  DenyCaseParticipationPort,
  OutboxOnlyWorkflowSignal,
  unconfiguredAttachmentStorage,
  type AttachmentObjectDescriptor,
  type AttachmentStoragePort,
  type CaseParticipationPort,
  type WorkflowSignalPort,
} from './ports/external.js';
import type {
  AttachmentRow,
  DbSession,
  MessageRow,
  MessageWithState,
  MessagingStore,
  MessagingTx,
  IdempotencyKeyRef,
  ParticipantRow,
  ReadReceiptRow,
  StoredResponse,
  ThreadRow,
  ThreadTransitionRow,
} from './store/types.js';
import {
  assertNoOpenDomainTransaction,
  guardOutboundPort,
  runInDomainTransaction,
} from './tx-scope.js';

export const ENDPOINTS = {
  openThread: 'POST /v1/threads',
  addParticipant: 'POST /v1/threads/{thread_id}/participants',
  removeParticipant: 'POST /v1/threads/{thread_id}/participants/remove',
  sendMessage: 'POST /v1/threads/{thread_id}/messages',
  retractMessage: 'POST /v1/threads/{thread_id}/messages/{message_id}/retract',
  acknowledge: 'POST /v1/threads/{thread_id}/messages/{message_id}/acknowledge',
  command: 'POST /v1/threads/{thread_id}/commands',
} as const;

export const ATTACHMENT_ACCESS_TTL_MS = 5 * 60 * 1000;

export interface MessagingServiceDeps {
  store: MessagingStore;
  authorizer: AuthorizationPort;
  participation?: CaseParticipationPort;
  storage?: AttachmentStoragePort;
  workflow?: WorkflowSignalPort;
  config?: Cmp026Config;
  clock?: () => Date;
}

export interface ServiceResult extends StoredResponse {
  replayed: boolean;
}

function sessionOf(ctx: TenantRequestContext): DbSession {
  return {
    tenantId: ctx.tenant_id,
    cellId: ctx.cell_id,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    correlationId: ctx.correlation_id,
  };
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new Cmp026Error('SF-SYS-003', { details: detail('UNKNOWN_FIELD', `/${key}`) });
    }
  }
}

function requireBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('BODY_REQUIRED') });
  }
  return body;
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('IDEMPOTENCY_KEY_REQUIRED') });
  }
  return value;
}

function requireId(value: unknown, pointer: string): string {
  if (!isUuid(value)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('ID_INVALID', pointer) });
  }
  return value.toLowerCase();
}

function optionalCode(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  if (!isCode(value)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('CODE_INVALID', pointer) });
  }
  return value;
}

function notFound(): Cmp026Error {
  return new Cmp026Error('SF-SYS-002', { details: detail('THREAD_NOT_FOUND') });
}

function resourceOf(thread: ThreadRow): ResourceAttributes {
  return {
    applicationId: thread.application_id,
    ownerId: thread.created_by,
    organisationId: thread.organisation_id,
    jurisdictionId: thread.jurisdiction_id,
  };
}

function threadView(row: ThreadRow): Record<string, unknown> {
  return {
    thread_id: row.thread_id,
    application_id: row.application_id,
    subject_code: row.subject_code,
    status: row.status,
    aggregate_version: row.aggregate_version,
    message_count: row.message_seq,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function participantView(p: ParticipantRow): Record<string, unknown> {
  return {
    participant_ref: p.participant_ref,
    role_code: p.role_code,
    added_at: p.added_at,
    removed_at: p.removed_at,
  };
}

/** SF-CON-MESSAGE-THREAD document (FROZEN). Active participants only; keys are CMP-032 refs. */
export function messageThreadContract(
  thread: ThreadRow,
  participants: ParticipantRow[],
  attachments: AttachmentRow[],
  receipts: ReadReceiptRow[],
  correlationId: string,
): Record<string, unknown> {
  const active = participants.filter((p) => p.removed_at === null);
  const refByActor = new Map(participants.map((p) => [p.actor_id, p.participant_ref]));
  return {
    contract_id: 'SF-CON-MESSAGE-THREAD',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: thread.tenant_id,
    thread_id: thread.thread_id,
    application_id: thread.application_id,
    participants: active.map((p) => ({
      participant_ref: p.participant_ref,
      role_code: p.role_code,
      tenant_id: thread.tenant_id,
    })),
    attachment_storage_keys: [...new Set(attachments.map((a) => a.storage_key))],
    read_receipts: receipts
      .filter((r) => refByActor.has(r.actor_id))
      .map((r) => ({ participant_ref: refByActor.get(r.actor_id), read_at: r.read_at })),
    isolation_class: 'TENANT_SCOPED',
    cross_tenant_participants_forbidden: true,
    correlation_id: correlationId,
  };
}

function messageView(m: MessageWithState, attachments: AttachmentRow[]): Record<string, unknown> {
  const retracted = m.retracted_at !== null;
  return {
    message_id: m.message_id,
    thread_id: m.thread_id,
    sequence: m.sequence,
    kind: m.kind,
    sender_participant_ref: m.sender_participant_ref,
    sender_actor_type: m.sender_actor_type,
    body: retracted ? null : m.body_text,
    content_sha256: m.kind === 'OFFICIAL_NOTICE' ? m.body_sha256 : undefined,
    retracted,
    retracted_at: m.retracted_at,
    ack_required: m.ack_required,
    ack_due_at: m.ack_due_at,
    ack_count: m.ack_count,
    attachments: retracted
      ? []
      : attachments
          .filter((a) => a.message_id === m.message_id)
          .map((a) => ({
            attachment_id: a.attachment_id,
            storage_key: a.storage_key,
            byte_size: a.byte_size,
            checksum_sha256: a.checksum_sha256,
          })),
    created_at: m.created_at,
  };
}

interface Snapshot {
  thread: ThreadRow;
  me: ParticipantRow;
}

export class MessagingService {
  readonly ports: {
    authorizer: AuthorizationPort;
    participation: CaseParticipationPort;
    storage: AttachmentStoragePort;
    workflow: WorkflowSignalPort;
  };
  private readonly store: MessagingStore;
  private readonly authorizer: AuthorizationPort;
  private readonly participation: CaseParticipationPort;
  private readonly storage: AttachmentStoragePort;
  private readonly workflow: WorkflowSignalPort;
  private readonly config: Cmp026Config;
  private readonly clock: () => Date;

  constructor(deps: MessagingServiceDeps) {
    this.store = deps.store;
    this.config = deps.config ?? loadConfig();
    this.clock = deps.clock ?? (() => new Date());
    const participation = deps.participation ?? new DenyCaseParticipationPort();
    const storage = deps.storage ?? unconfiguredAttachmentStorage;
    assertPortAllowed(participation, this.config.environment, 'PARTICIPATION');
    assertPortAllowed(storage, this.config.environment, 'STORAGE');
    this.authorizer = guardOutboundPort('authorization', deps.authorizer);
    this.participation = guardOutboundPort('participation', participation);
    this.storage = guardOutboundPort('storage', storage);
    this.workflow = guardOutboundPort('workflow', deps.workflow ?? new OutboxOnlyWorkflowSignal());
    this.ports = {
      authorizer: this.authorizer,
      participation: this.participation,
      storage: this.storage,
      workflow: this.workflow,
    };
  }

  async openThread(rawCtx: unknown, rawBody: unknown, rawKey: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['application_id', 'subject_code', 'opener_role_code', 'participants']);
    const applicationId = requireId(body['application_id'], '/application_id');
    const subjectCode = optionalCode(body['subject_code'], '/subject_code');
    const openerRole = body['opener_role_code'];
    if (!isCode(openerRole) || !ctx.roles.includes(openerRole)) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('OPENER_ROLE_INVALID', '/opener_role_code'),
      });
    }
    const others = this.parseParticipants(body['participants'], ctx.tenant_id);
    const now = this.clock();
    const authz = await authorizeAction(
      this.authorizer,
      ctx,
      'THREAD_OPEN',
      {
        applicationId,
        ownerId: ctx.actor.id,
        organisationId: ctx.organisation_id ?? null,
        jurisdictionId: ctx.jurisdiction_ids[0] ?? null,
      },
      now,
    );
    if (!(await this.participation.canOpenThread(ctx, { application_id: applicationId }))) {
      throw new Cmp026Error('SF-AUTH-002', { details: detail('CASE_ACCESS_DENIED') });
    }
    const opener: ParticipantInput = { actor_id: ctx.actor.id, role_code: openerRole };
    const all = [opener, ...others];
    if (new Set(all.map((p) => p.actor_id)).size !== all.length) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('PARTICIPANT_DUPLICATE', '/participants'),
      });
    }
    await this.assertParticipantsEligible(ctx, applicationId, all);

    const threadId = randomUUID();
    const occurred = now.toISOString();
    const thread: ThreadRow = {
      thread_id: threadId,
      tenant_id: ctx.tenant_id,
      cell_id: ctx.cell_id,
      application_id: applicationId,
      subject_code: subjectCode,
      status: 'OPEN',
      aggregate_version: 1,
      message_seq: 0,
      organisation_id: ctx.organisation_id ?? null,
      jurisdiction_id: ctx.jurisdiction_ids[0] ?? null,
      created_by: ctx.actor.id,
      created_at: occurred,
      updated_at: occurred,
      last_correlation_id: ctx.correlation_id,
    };
    const participants = all.map((p): ParticipantRow => ({
      participant_id: randomUUID(),
      tenant_id: ctx.tenant_id,
      thread_id: threadId,
      actor_id: p.actor_id,
      participant_ref: participantRef(threadId, p.actor_id),
      role_code: p.role_code,
      added_by: ctx.actor.id,
      added_at: occurred,
      removed_at: null,
      removed_by: null,
    }));
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.openThread,
      key,
      fingerprint: sha256Of({ applicationId, subjectCode, openerRole, all }),
      now,
      write: async (tx) => {
        await tx.insertThread(thread);
        for (const p of participants) await tx.insertParticipant(p);
        await tx.insertTransition(
          this.transitionRow(thread, null, 'OPEN_THREAD', authz, ctx, key, occurred),
        );
        await this.emit(tx, ctx, thread, EVENT_TYPES.threadOpened, 'THREAD_OPEN', occurred, {
          application_id: applicationId,
          participant_refs: participants.map((p) => p.participant_ref),
        });
        return {
          status: 201,
          body: { thread: threadView(thread), participants: participants.map(participantView) },
        };
      },
    });
  }

  async getThread(rawCtx: unknown, threadId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'THREAD_READ', resourceOf(snap.thread), now);
    const view = await this.store.withTx(sessionOf(ctx), async (tx) => ({
      participants: await tx.listParticipants(id),
      attachments: await tx.listAttachments(id),
      receipts: await tx.listReadReceipts(id),
    }));
    return {
      status: 200,
      body: {
        thread: threadView(snap.thread),
        participants: view.participants.filter((p) => p.removed_at === null).map(participantView),
        message_thread: messageThreadContract(
          snap.thread,
          view.participants,
          view.attachments,
          view.receipts,
          ctx.correlation_id,
        ),
      },
      replayed: false,
    };
  }

  async listThreadsForApplication(rawCtx: unknown, applicationId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const appId = requireId(applicationId, '/application_id');
    await authorizeAction(
      this.authorizer,
      ctx,
      'THREAD_LIST',
      { applicationId: appId, organisationId: ctx.organisation_id ?? null },
      this.clock(),
    );
    const rows = await this.store.withTx(sessionOf(ctx), (tx) =>
      tx.listThreadsForActor(appId, ctx.actor.id),
    );
    return { status: 200, body: { threads: rows.map(threadView) }, replayed: false };
  }

  async listTransitions(rawCtx: unknown, threadId: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(
      this.authorizer,
      ctx,
      'THREAD_READ',
      resourceOf(snap.thread),
      this.clock(),
    );
    const rows = await this.store.withTx(sessionOf(ctx), (tx) => tx.listTransitions(id));
    return {
      status: 200,
      body: {
        transitions: rows.map(({ tenant_id: _t, actor_id: _a, ...rest }) => rest),
      },
      replayed: false,
    };
  }

  async addParticipant(
    rawCtx: unknown,
    threadId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    const input = parseParticipant(body, ctx.tenant_id, '');
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'PARTICIPANT_ADD', resourceOf(snap.thread), now);
    assertThreadAcceptsMessages(snap.thread.status);
    await this.assertParticipantsEligible(ctx, snap.thread.application_id, [input]);
    const occurred = now.toISOString();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.addParticipant,
      key,
      fingerprint: sha256Of({ id, input }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        assertThreadAcceptsMessages(locked.status);
        const existing = await tx.getParticipantByActor(id, input.actor_id);
        if (existing) {
          throw new Cmp026Error('SF-APP-001', {
            details: detail(existing.removed_at ? 'PARTICIPANT_REMOVED' : 'PARTICIPANT_EXISTS'),
          });
        }
        if ((await tx.countActiveParticipants(id)) >= MAX_PARTICIPANTS_PER_THREAD) {
          throw new Cmp026Error('SF-APP-001', { details: detail('PARTICIPANT_LIMIT') });
        }
        const row: ParticipantRow = {
          participant_id: randomUUID(),
          tenant_id: ctx.tenant_id,
          thread_id: id,
          actor_id: input.actor_id,
          participant_ref: participantRef(id, input.actor_id),
          role_code: input.role_code,
          added_by: ctx.actor.id,
          added_at: occurred,
          removed_at: null,
          removed_by: null,
        };
        await tx.insertParticipant(row);
        await this.emit(
          tx,
          ctx,
          locked,
          EVENT_TYPES.participantAdded,
          'PARTICIPANT_ADD',
          occurred,
          { participant_ref: row.participant_ref, role_code: row.role_code },
        );
        return { status: 201, body: { participant: participantView(row) } };
      },
    });
  }

  async removeParticipant(
    rawCtx: unknown,
    threadId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['actor_id']);
    const target = requireId(body['actor_id'], '/actor_id');
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'PARTICIPANT_REMOVE', resourceOf(snap.thread), now);
    const occurred = now.toISOString();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.removeParticipant,
      key,
      fingerprint: sha256Of({ id, target }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        const existing = await tx.getParticipantByActor(id, target);
        if (!existing || existing.removed_at) {
          throw new Cmp026Error('SF-SYS-002', { details: detail('PARTICIPANT_NOT_FOUND') });
        }
        if ((await tx.countActiveParticipants(id)) <= 1) {
          throw new Cmp026Error('SF-APP-001', { details: detail('LAST_PARTICIPANT') });
        }
        const ok = await tx.removeParticipant({
          threadId: id,
          actorId: target,
          removedBy: ctx.actor.id,
          removedAt: occurred,
        });
        if (!ok) throw new Cmp026Error('SF-APP-001', { details: detail('CONCURRENT_UPDATE') });
        await this.emit(
          tx,
          ctx,
          locked,
          EVENT_TYPES.participantRemoved,
          'PARTICIPANT_REMOVE',
          occurred,
          { participant_ref: existing.participant_ref },
        );
        return {
          status: 200,
          body: { participant: participantView({ ...existing, removed_at: occurred }) },
        };
      },
    });
  }

  async sendMessage(
    rawCtx: unknown,
    threadId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['kind', 'body', 'attachment_storage_keys', 'ack_required', 'ack_due_at']);
    const kind: MessageKind = body['kind'] === undefined ? 'MESSAGE' : parseKind(body['kind']);
    const text = parseBody(body['body']);
    const keys = parseStorageKeys(body['attachment_storage_keys']);
    const ackRequired = parseAckRequired(body['ack_required'], kind);
    const now = this.clock();
    const ackDueAt = parseAckDue(body['ack_due_at'], ackRequired, now);
    if (kind === 'OFFICIAL_NOTICE') assertNoticeSenderIsAuthority(ctx.actor.type);
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(
      this.authorizer,
      ctx,
      kind === 'OFFICIAL_NOTICE' ? 'NOTICE_SEND' : 'MESSAGE_SEND',
      resourceOf(snap.thread),
      now,
    );
    assertThreadAcceptsMessages(snap.thread.status);
    const described = await this.describeAttachments(ctx, keys);
    const occurred = now.toISOString();
    const digest = bodyDigest(text);
    const result = await this.mutate(ctx, {
      endpoint: ENDPOINTS.sendMessage,
      key,
      fingerprint: sha256Of({ id, kind, digest, keys, ackRequired, ackDueAt }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        assertThreadAcceptsMessages(locked.status);
        const me = await tx.getParticipantByActor(id, ctx.actor.id);
        if (!me || me.removed_at) throw notFound();
        const sequence = await tx.nextMessageSequence({
          threadId: id,
          updatedAt: occurred,
          correlationId: ctx.correlation_id,
        });
        if (sequence === null) {
          throw new Cmp026Error('SF-APP-001', { details: detail('THREAD_NOT_OPEN') });
        }
        const message: MessageRow = {
          message_id: randomUUID(),
          tenant_id: ctx.tenant_id,
          thread_id: id,
          sequence,
          kind,
          sender_actor_type: ctx.actor.type,
          sender_id: ctx.actor.id,
          sender_participant_ref: me.participant_ref,
          body_text: text,
          body_sha256: digest,
          ack_required: ackRequired,
          ack_due_at: ackDueAt,
          created_at: occurred,
          correlation_id: ctx.correlation_id,
        };
        await tx.insertMessage(message);
        const attachments: AttachmentRow[] = [];
        for (const [storageKey, d] of described) {
          const row: AttachmentRow = {
            attachment_id: randomUUID(),
            tenant_id: ctx.tenant_id,
            thread_id: id,
            message_id: message.message_id,
            storage_key: storageKey,
            byte_size: d.byte_size,
            checksum_sha256: d.checksum_sha256,
            scan_verdict: 'CLEAN',
            created_at: occurred,
          };
          await tx.insertAttachment(row);
          attachments.push(row);
        }
        const recipients = (await tx.listParticipants(id))
          .filter((p) => p.removed_at === null && p.actor_id !== ctx.actor.id)
          .map((p) => p.participant_ref);
        await this.emit(
          tx,
          ctx,
          locked,
          EVENT_TYPES.messageSent,
          kind === 'OFFICIAL_NOTICE' ? 'NOTICE_SEND' : 'MESSAGE_SEND',
          occurred,
          {
            message_id: message.message_id,
            sequence,
            kind,
            application_id: locked.application_id,
            sender_participant_ref: me.participant_ref,
            recipient_participant_refs: recipients,
            attachment_count: attachments.length,
            ack_required: ackRequired,
            ack_due_at: ackDueAt,
            content_sha256: digest,
          },
          message.message_id,
        );
        return {
          status: 201,
          body: {
            message: messageView({ ...message, retracted_at: null, ack_count: 0 }, attachments),
          },
        };
      },
    });
    if (!result.replayed && kind === 'OFFICIAL_NOTICE' && ackRequired) {
      const sent = (result.body as { message: { message_id: string } }).message;
      await this.signalNotice(ctx, snap.thread, sent.message_id, ackDueAt, key);
    }
    return result;
  }

  async listMessages(rawCtx: unknown, threadId: unknown, query: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const q = isPlainObject(query) ? query : {};
    const after =
      q['after_sequence'] === undefined
        ? 0
        : parseSequence(q['after_sequence'], '/after_sequence', 0);
    const limit = parsePageSize(q['limit']);
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(
      this.authorizer,
      ctx,
      'MESSAGE_READ',
      resourceOf(snap.thread),
      this.clock(),
    );
    const page = await this.store.withTx(sessionOf(ctx), async (tx) => {
      const messages = await tx.listMessages({
        threadId: id,
        afterSequence: after,
        limit: limit + 1,
      });
      const shown = messages.slice(0, limit);
      const attachments = await tx.listAttachments(
        id,
        shown.map((m) => m.message_id),
      );
      return { shown, attachments, more: messages.length > limit };
    });
    const last = page.shown[page.shown.length - 1];
    return {
      status: 200,
      body: {
        messages: page.shown.map((m) => messageView(m, page.attachments)),
        next_after_sequence: page.more && last ? last.sequence : null,
      },
      replayed: false,
    };
  }

  async retractMessage(
    rawCtx: unknown,
    threadId: unknown,
    messageId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const mid = requireId(messageId, '/message_id');
    const key = parseIdempotencyKey(rawKey);
    const body = rawBody === undefined ? {} : requireBody(rawBody);
    assertOnlyKeys(body, ['reason_code']);
    const reason = optionalCode(body['reason_code'], '/reason_code');
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'MESSAGE_RETRACT', resourceOf(snap.thread), now);
    const occurred = now.toISOString();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.retractMessage,
      key,
      fingerprint: sha256Of({ id, mid, reason }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        const message = await tx.getMessage(id, mid);
        if (!message) throw new Cmp026Error('SF-SYS-002', { details: detail('MESSAGE_NOT_FOUND') });
        if (message.kind !== 'MESSAGE') {
          throw new Cmp026Error('SF-APP-001', { details: detail('NOTICE_IMMUTABLE') });
        }
        if (message.sender_id !== ctx.actor.id) {
          throw new Cmp026Error('SF-AUTH-002', { details: detail('NOT_MESSAGE_SENDER') });
        }
        if (message.retracted_at) {
          throw new Cmp026Error('SF-APP-001', { details: detail('ALREADY_RETRACTED') });
        }
        await tx.insertRetraction({
          retraction_id: randomUUID(),
          tenant_id: ctx.tenant_id,
          thread_id: id,
          message_id: mid,
          retracted_by: ctx.actor.id,
          reason_code: reason,
          retracted_at: occurred,
          correlation_id: ctx.correlation_id,
        });
        await this.emit(
          tx,
          ctx,
          locked,
          EVENT_TYPES.messageRetracted,
          'MESSAGE_RETRACT',
          occurred,
          { message_id: mid, sequence: message.sequence, reason_code: reason },
          mid,
        );
        return {
          status: 200,
          body: { message_id: mid, retracted: true, retracted_at: occurred },
        };
      },
    });
  }

  async acknowledgeNotice(
    rawCtx: unknown,
    threadId: unknown,
    messageId: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const mid = requireId(messageId, '/message_id');
    const key = parseIdempotencyKey(rawKey);
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'NOTICE_ACKNOWLEDGE', resourceOf(snap.thread), now);
    const occurred = now.toISOString();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.acknowledge,
      key,
      fingerprint: sha256Of({ id, mid }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        const message = await tx.getMessage(id, mid);
        if (!message) throw new Cmp026Error('SF-SYS-002', { details: detail('MESSAGE_NOT_FOUND') });
        if (message.kind !== 'OFFICIAL_NOTICE' || !message.ack_required) {
          throw new Cmp026Error('SF-APP-001', { details: detail('ACK_NOT_REQUIRED') });
        }
        if (message.sender_id === ctx.actor.id) {
          throw new Cmp026Error('SF-APP-001', { details: detail('SENDER_CANNOT_ACKNOWLEDGE') });
        }
        if (await tx.getAck(mid, ctx.actor.id)) {
          throw new Cmp026Error('SF-APP-001', { details: detail('ALREADY_ACKNOWLEDGED') });
        }
        await tx.insertAck({
          ack_id: randomUUID(),
          tenant_id: ctx.tenant_id,
          thread_id: id,
          message_id: mid,
          actor_id: ctx.actor.id,
          acknowledged_at: occurred,
          correlation_id: ctx.correlation_id,
        });
        const late = message.ack_due_at !== null && Date.parse(message.ack_due_at) < now.getTime();
        await this.emit(
          tx,
          ctx,
          locked,
          EVENT_TYPES.noticeAcknowledged,
          'NOTICE_ACKNOWLEDGE',
          occurred,
          {
            message_id: mid,
            application_id: locked.application_id,
            acknowledged_by_participant_ref: snap.me.participant_ref,
            after_due: late,
          },
          mid,
        );
        return {
          status: 201,
          body: { message_id: mid, acknowledged: true, acknowledged_at: occurred, after_due: late },
        };
      },
    });
  }

  async markRead(rawCtx: unknown, threadId: unknown, rawBody: unknown): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['up_to_sequence']);
    const upTo = parseSequence(body['up_to_sequence'], '/up_to_sequence', 0);
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'READ_RECEIPT_MARK', resourceOf(snap.thread), now);
    if (upTo > snap.thread.message_seq) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('SEQUENCE_INVALID', '/up_to_sequence'),
      });
    }
    const occurred = now.toISOString();
    await this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(async () => {
        await tx.upsertReadReceipt({
          threadId: id,
          actorId: ctx.actor.id,
          lastReadSequence: upTo,
          readAt: occurred,
        });
        await tx.insertOutbox(
          auditEnvelope(ctx, {
            action: 'READ_RECEIPT_MARK',
            actionClass: 'WRITE',
            resourceId: id,
            result: 'SUCCESS',
            occurredAt: occurred,
          }),
          TOPIC_AUDIT,
        );
      }),
    );
    return {
      status: 200,
      body: { thread_id: id, last_read_sequence: upTo, read_at: occurred },
      replayed: false,
    };
  }

  async executeCommand(
    rawCtx: unknown,
    threadId: unknown,
    rawBody: unknown,
    rawKey: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const key = parseIdempotencyKey(rawKey);
    const body = requireBody(rawBody);
    assertOnlyKeys(body, ['command', 'expected_status', 'expected_version']);
    if (!isThreadCommand(body['command'])) {
      throw new Cmp026Error('SF-SYS-003', { details: detail('COMMAND_INVALID', '/command') });
    }
    const command: ThreadCommand = body['command'];
    if (!isThreadStatus(body['expected_status'])) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('EXPECTED_STATUS_INVALID', '/expected_status'),
      });
    }
    const expectedStatus = body['expected_status'];
    const expectedVersion = body['expected_version'];
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('EXPECTED_VERSION_INVALID', '/expected_version'),
      });
    }
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    planThreadTransition({
      command,
      from: snap.thread.status,
      expectedStatus,
      expectedVersion,
      currentVersion: snap.thread.aggregate_version,
    });
    const authz = await authorizeAction(
      this.authorizer,
      ctx,
      `THREAD_${command}`,
      resourceOf(snap.thread),
      now,
    );
    const occurred = now.toISOString();
    return this.mutate(ctx, {
      endpoint: ENDPOINTS.command,
      key,
      fingerprint: sha256Of({ id, command, expectedStatus, expectedVersion }),
      now,
      write: async (tx) => {
        const locked = await tx.getThread(id, { forUpdate: true });
        if (!locked) throw notFound();
        const plan = planThreadTransition({
          command,
          from: locked.status,
          expectedStatus,
          expectedVersion,
          currentVersion: locked.aggregate_version,
        });
        const ok = await tx.updateThreadStatus({
          threadId: id,
          fromStatus: locked.status,
          toStatus: plan.to,
          fromVersion: locked.aggregate_version,
          updatedAt: occurred,
          correlationId: ctx.correlation_id,
        });
        if (!ok) throw new Cmp026Error('SF-APP-001', { details: detail('STALE_VERSION') });
        const next: ThreadRow = {
          ...locked,
          status: plan.to,
          aggregate_version: plan.nextVersion,
          updated_at: occurred,
          last_correlation_id: ctx.correlation_id,
        };
        await tx.insertTransition(
          this.transitionRow(next, locked.status, command, authz, ctx, key, occurred),
        );
        await this.emit(
          tx,
          ctx,
          next,
          EVENT_TYPES.threadStatusChanged,
          `THREAD_${command}`,
          occurred,
          {
            command,
            from_status: locked.status,
            to_status: next.status,
            authz_policy_revision: authz.policyRevision,
          },
        );
        return { status: 200, body: { thread: threadView(next) } };
      },
    });
  }

  async getAttachmentAccess(
    rawCtx: unknown,
    threadId: unknown,
    attachmentId: unknown,
  ): Promise<ServiceResult> {
    const ctx = requireTenantContext(rawCtx);
    const id = requireId(threadId, '/thread_id');
    const aid = requireId(attachmentId, '/attachment_id');
    const now = this.clock();
    const snap = await this.snapshot(ctx, id);
    await authorizeAction(this.authorizer, ctx, 'ATTACHMENT_ACCESS', resourceOf(snap.thread), now);
    const found = await this.store.withTx(sessionOf(ctx), async (tx) => {
      const attachment = await tx.getAttachment(id, aid);
      if (!attachment) return null;
      const message = await tx.getMessage(id, attachment.message_id);
      return message?.retracted_at ? null : attachment;
    });
    if (!found) throw new Cmp026Error('SF-SYS-002', { details: detail('ATTACHMENT_NOT_FOUND') });
    assertNoOpenDomainTransaction('storage');
    const grant = await this.storage.issueDownloadAccess({
      tenantId: ctx.tenant_id,
      storageKey: found.storage_key,
      expiresAt: new Date(now.getTime() + ATTACHMENT_ACCESS_TTL_MS),
    });
    await this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(() =>
        tx.insertOutbox(
          auditEnvelope(ctx, {
            action: 'ATTACHMENT_ACCESS',
            actionClass: 'READ',
            resourceId: id,
            result: 'SUCCESS',
            occurredAt: now.toISOString(),
            afterRef: aid,
          }),
          TOPIC_AUDIT,
        ),
      ),
    );
    return {
      status: 200,
      body: { attachment_id: aid, access: grant },
      replayed: false,
    };
  }

  private parseParticipants(value: unknown, tenantId: string): ParticipantInput[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_PARTICIPANTS_PER_THREAD - 1) {
      throw new Cmp026Error('SF-SYS-003', {
        details: detail('PARTICIPANTS_INVALID', '/participants'),
      });
    }
    return value.map((v, i) => parseParticipant(v, tenantId, `/participants/${i}`));
  }

  private async assertParticipantsEligible(
    ctx: TenantRequestContext,
    applicationId: string,
    participants: ParticipantInput[],
  ): Promise<void> {
    for (const p of participants) {
      const ok = await this.participation.isEligibleParticipant(ctx, {
        application_id: applicationId,
        actor_id: p.actor_id,
        role_code: p.role_code,
      });
      if (!ok) {
        throw new Cmp026Error('SF-TEN-002', { details: detail('PARTICIPANT_NOT_ELIGIBLE') });
      }
    }
  }

  /** Tenant-scoped read; non-members get the same 404 as a missing thread (no existence oracle). */
  private async snapshot(ctx: TenantRequestContext, threadId: string): Promise<Snapshot> {
    const snap = await this.store.withTx(sessionOf(ctx), async (tx) => {
      const thread = await tx.getThread(threadId);
      if (!thread) return null;
      const me = await tx.getParticipantByActor(threadId, ctx.actor.id);
      if (!me || me.removed_at) return null;
      return { thread, me };
    });
    if (!snap) throw notFound();
    return snap;
  }

  private async describeAttachments(
    ctx: TenantRequestContext,
    keys: string[],
  ): Promise<Map<string, AttachmentObjectDescriptor>> {
    const out = new Map<string, AttachmentObjectDescriptor>();
    for (const [i, storageKey] of keys.entries()) {
      const pointer = `/attachment_storage_keys/${i}`;
      const d = await this.storage.describeObject({ tenantId: ctx.tenant_id, storageKey });
      if (!d) {
        throw new Cmp026Error('SF-SYS-003', { details: detail('ATTACHMENT_NOT_FOUND', pointer) });
      }
      if (d.scan_verdict !== 'CLEAN') {
        throw new Cmp026Error('SF-SYS-003', { details: detail('ATTACHMENT_NOT_CLEAN', pointer) });
      }
      out.set(storageKey, d);
    }
    return out;
  }

  private transitionRow(
    row: ThreadRow,
    from: ThreadRow['status'] | null,
    command: string,
    authz: AuthzOutcome,
    ctx: TenantRequestContext,
    key: string,
    occurred: string,
  ): ThreadTransitionRow {
    return {
      transition_id: randomUUID(),
      tenant_id: ctx.tenant_id,
      thread_id: row.thread_id,
      command,
      from_status: from,
      to_status: row.status,
      aggregate_version: row.aggregate_version,
      idempotency_key: key,
      authz_decision_id: authz.decisionId,
      authz_policy_revision: authz.policyRevision,
      correlation_id: ctx.correlation_id,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      occurred_at: occurred,
    };
  }

  private async emit(
    tx: MessagingTx,
    ctx: TenantRequestContext,
    thread: ThreadRow,
    eventType: string,
    action: string,
    occurred: string,
    data: Record<string, unknown>,
    afterRef?: string,
  ): Promise<void> {
    await tx.insertOutbox(
      envelopeOf({
        eventType,
        ctx,
        aggregateId: thread.thread_id,
        aggregateVersion: thread.aggregate_version,
        occurredAt: occurred,
        data: { thread_id: thread.thread_id, ...data },
      }),
      TOPIC_DOMAIN,
    );
    await tx.insertOutbox(
      auditEnvelope(ctx, {
        action,
        actionClass: 'WRITE',
        resourceId: thread.thread_id,
        result: 'SUCCESS',
        occurredAt: occurred,
        afterRef: afterRef ?? thread.thread_id,
      }),
      TOPIC_AUDIT,
    );
  }

  private async mutate(
    ctx: TenantRequestContext,
    params: {
      endpoint: string;
      key: string;
      fingerprint: string;
      now: Date;
      write: (tx: MessagingTx) => Promise<StoredResponse>;
    },
  ): Promise<ServiceResult> {
    const ref: IdempotencyKeyRef = {
      principalId: ctx.actor.id,
      endpoint: params.endpoint,
      key: params.key,
    };
    return this.store.withTx(sessionOf(ctx), (tx) =>
      runInDomainTransaction(async () => {
        const claimed = await tx.claimIdempotency({
          ...ref,
          fingerprint: params.fingerprint,
          now: params.now,
        });
        if (claimed !== 'claimed') {
          return { ...claimed, replayed: true };
        }
        const stored = await params.write(tx);
        await tx.completeIdempotency({ ...ref, response: stored });
        return { ...stored, replayed: false };
      }),
    );
  }

  private async signalNotice(
    ctx: TenantRequestContext,
    thread: ThreadRow,
    messageId: string,
    ackDueAt: string | null,
    key: string,
  ): Promise<void> {
    assertNoOpenDomainTransaction('after-commit');
    try {
      await this.workflow.signalNotice({
        tenant_id: ctx.tenant_id,
        application_id: thread.application_id,
        thread_id: thread.thread_id,
        message_id: messageId,
        ack_due_at: ackDueAt,
        idempotency_key: key,
        correlation_id: ctx.correlation_id,
      });
    } catch {
      /* the committed outbox event remains the durable trigger */
    }
  }
}

function parseKind(value: unknown): MessageKind {
  if (!isMessageKind(value)) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('KIND_INVALID', '/kind') });
  }
  return value;
}

function parseAckRequired(value: unknown, kind: MessageKind): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new Cmp026Error('SF-SYS-003', {
      details: detail('ACK_REQUIRED_INVALID', '/ack_required'),
    });
  }
  if (value && kind !== 'OFFICIAL_NOTICE') {
    throw new Cmp026Error('SF-SYS-003', {
      details: detail('ACK_ONLY_FOR_NOTICE', '/ack_required'),
    });
  }
  return value;
}

function parseAckDue(value: unknown, ackRequired: boolean, now: Date): string | null {
  if (value === undefined || value === null) return null;
  if (!ackRequired) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('ACK_DUE_WITHOUT_ACK', '/ack_due_at') });
  }
  if (!isIsoTimestamp(value) || Date.parse(value) <= now.getTime()) {
    throw new Cmp026Error('SF-SYS-003', { details: detail('ACK_DUE_INVALID', '/ack_due_at') });
  }
  return new Date(value).toISOString();
}
