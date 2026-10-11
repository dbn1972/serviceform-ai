import type { EventEnvelope } from '../../src/domain/validate.js';
import { Cmp026Error, mapPgError } from '../../src/errors.js';
import type {
  AckRow,
  AttachmentRow,
  DbSession,
  IdempotencyKeyRef,
  IdempotencyLookup,
  MessageRow,
  MessageWithState,
  MessagingStore,
  MessagingTx,
  ParticipantRow,
  ReadReceiptRow,
  RetractionRow,
  StoredResponse,
  ThreadRow,
  ThreadTransitionRow,
} from '../../src/store/types.js';
import type { ThreadStatus } from '../../src/domain/model.js';

interface IdemRow {
  fingerprint: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response: StoredResponse | null;
}

export interface OutboxRow {
  tenant_id: string;
  topic: string;
  envelope: EventEnvelope<object>;
}

export interface State {
  threads: Map<string, ThreadRow>;
  transitions: ThreadTransitionRow[];
  participants: ParticipantRow[];
  messages: MessageRow[];
  attachments: AttachmentRow[];
  retractions: RetractionRow[];
  acks: AckRow[];
  receipts: (ReadReceiptRow & { tenant_id: string })[];
  idem: Map<string, IdemRow>;
  outbox: OutboxRow[];
}

function empty(): State {
  return {
    threads: new Map(),
    transitions: [],
    participants: [],
    messages: [],
    attachments: [],
    retractions: [],
    acks: [],
    receipts: [],
    idem: new Map(),
    outbox: [],
  };
}

export class MemoryMessagingStore implements MessagingStore {
  state: State = empty();
  txCount = 0;
  hooks: { onOutbox?: (env: EventEnvelope<object>, topic: string) => Promise<void> } = {};

  async withTx<T>(session: DbSession, fn: (tx: MessagingTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    const work = structuredClone(this.state);
    try {
      const result = await fn(new MemoryTx(work, session, this));
      this.state = work;
      return result;
    } catch (err) {
      throw mapPgError(err);
    }
  }

  outboxFor(tenantId: string, topic?: string): OutboxRow[] {
    return this.state.outbox.filter(
      (o) => o.tenant_id === tenantId && (topic === undefined || o.topic === topic),
    );
  }
}

class MemoryTx implements MessagingTx {
  constructor(
    private readonly s: State,
    private readonly session: DbSession,
    private readonly owner: MemoryMessagingStore,
  ) {}

  private mine<T extends { tenant_id: string }>(row: T): boolean {
    return row.tenant_id === this.session.tenantId;
  }

  private idemKey(ref: IdempotencyKeyRef): string {
    return `${this.session.tenantId}|${ref.principalId}|${ref.endpoint}|${ref.key}`;
  }

  async lookupIdempotency(ref: IdempotencyKeyRef): Promise<IdempotencyLookup> {
    const row = this.s.idem.get(this.idemKey(ref));
    if (!row) return { state: 'absent' };
    if (row.status === 'COMPLETED' && row.response) {
      return {
        state: 'completed',
        fingerprint: row.fingerprint,
        response: structuredClone(row.response),
      };
    }
    return { state: 'pending', fingerprint: row.fingerprint };
  }

  async claimIdempotency(
    ref: IdempotencyKeyRef & { fingerprint: string; now: Date },
  ): Promise<'claimed' | StoredResponse> {
    const k = this.idemKey(ref);
    const row = this.s.idem.get(k);
    if (!row) {
      this.s.idem.set(k, { fingerprint: ref.fingerprint, status: 'IN_PROGRESS', response: null });
      return 'claimed';
    }
    if (row.fingerprint !== ref.fingerprint) throw new Cmp026Error('SF-APP-002');
    if (row.status === 'COMPLETED' && row.response) return structuredClone(row.response);
    throw new Cmp026Error('SF-APP-002');
  }

  async completeIdempotency(ref: IdempotencyKeyRef & { response: StoredResponse }): Promise<void> {
    const row = this.s.idem.get(this.idemKey(ref));
    if (row) {
      row.status = 'COMPLETED';
      row.response = structuredClone(ref.response);
    }
  }

  async insertThread(row: ThreadRow): Promise<void> {
    if (!this.mine(row)) throw Object.assign(new Error('rls'), { code: '42501' });
    if (this.s.threads.has(row.thread_id)) throw Object.assign(new Error('dup'), { code: '23505' });
    this.s.threads.set(row.thread_id, structuredClone(row));
  }

  async getThread(id: string): Promise<ThreadRow | null> {
    const row = this.s.threads.get(id);
    return row && this.mine(row) ? structuredClone(row) : null;
  }

  async listThreadsForActor(applicationId: string, actorId: string): Promise<ThreadRow[]> {
    return [...this.s.threads.values()]
      .filter(
        (t) =>
          this.mine(t) &&
          t.application_id === applicationId &&
          this.s.participants.some(
            (p) => p.thread_id === t.thread_id && p.actor_id === actorId && p.removed_at === null,
          ),
      )
      .map((t) => structuredClone(t));
  }

  async updateThreadStatus(params: {
    threadId: string;
    fromStatus: ThreadStatus;
    toStatus: ThreadStatus;
    fromVersion: number;
    updatedAt: string;
    correlationId: string;
  }): Promise<boolean> {
    const row = this.s.threads.get(params.threadId);
    if (!row || !this.mine(row)) return false;
    if (row.status !== params.fromStatus || row.aggregate_version !== params.fromVersion) {
      return false;
    }
    row.status = params.toStatus;
    row.aggregate_version += 1;
    row.updated_at = params.updatedAt;
    row.last_correlation_id = params.correlationId;
    return true;
  }

  async nextMessageSequence(params: {
    threadId: string;
    updatedAt: string;
    correlationId: string;
  }): Promise<number | null> {
    const row = this.s.threads.get(params.threadId);
    if (!row || !this.mine(row) || row.status !== 'OPEN') return null;
    row.message_seq += 1;
    row.updated_at = params.updatedAt;
    row.last_correlation_id = params.correlationId;
    return row.message_seq;
  }

  async insertTransition(row: ThreadTransitionRow): Promise<void> {
    this.s.transitions.push(structuredClone(row));
  }

  async listTransitions(threadId: string): Promise<ThreadTransitionRow[]> {
    return this.s.transitions.filter((t) => t.thread_id === threadId && this.mine(t));
  }

  async insertParticipant(row: ParticipantRow): Promise<void> {
    if (!this.mine(row)) throw Object.assign(new Error('rls'), { code: '42501' });
    this.s.participants.push(structuredClone(row));
  }

  async getParticipantByActor(threadId: string, actorId: string): Promise<ParticipantRow | null> {
    const p = this.s.participants.find(
      (x) => x.thread_id === threadId && x.actor_id === actorId && this.mine(x),
    );
    return p ? structuredClone(p) : null;
  }

  async listParticipants(threadId: string): Promise<ParticipantRow[]> {
    return this.s.participants
      .filter((p) => p.thread_id === threadId && this.mine(p))
      .map((p) => structuredClone(p));
  }

  async countActiveParticipants(threadId: string): Promise<number> {
    return this.s.participants.filter(
      (p) => p.thread_id === threadId && this.mine(p) && p.removed_at === null,
    ).length;
  }

  async removeParticipant(params: {
    threadId: string;
    actorId: string;
    removedBy: string;
    removedAt: string;
  }): Promise<boolean> {
    const p = this.s.participants.find(
      (x) =>
        x.thread_id === params.threadId &&
        x.actor_id === params.actorId &&
        this.mine(x) &&
        x.removed_at === null,
    );
    if (!p) return false;
    p.removed_at = params.removedAt;
    p.removed_by = params.removedBy;
    return true;
  }

  async insertMessage(row: MessageRow): Promise<void> {
    if (!this.mine(row)) throw Object.assign(new Error('rls'), { code: '42501' });
    this.s.messages.push(structuredClone(row));
  }

  private withState(m: MessageRow): MessageWithState {
    const r = this.s.retractions.find((x) => x.message_id === m.message_id);
    return {
      ...structuredClone(m),
      retracted_at: r ? r.retracted_at : null,
      ack_count: this.s.acks.filter((a) => a.message_id === m.message_id).length,
    };
  }

  async getMessage(threadId: string, messageId: string): Promise<MessageWithState | null> {
    const m = this.s.messages.find(
      (x) => x.thread_id === threadId && x.message_id === messageId && this.mine(x),
    );
    return m ? this.withState(m) : null;
  }

  async listMessages(params: {
    threadId: string;
    afterSequence: number;
    limit: number;
  }): Promise<MessageWithState[]> {
    return this.s.messages
      .filter(
        (m) => m.thread_id === params.threadId && this.mine(m) && m.sequence > params.afterSequence,
      )
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, params.limit)
      .map((m) => this.withState(m));
  }

  async insertAttachment(row: AttachmentRow): Promise<void> {
    this.s.attachments.push(structuredClone(row));
  }

  async listAttachments(threadId: string, messageIds?: string[]): Promise<AttachmentRow[]> {
    return this.s.attachments
      .filter(
        (a) =>
          a.thread_id === threadId &&
          this.mine(a) &&
          (messageIds === undefined || messageIds.includes(a.message_id)),
      )
      .map((a) => structuredClone(a));
  }

  async getAttachment(threadId: string, attachmentId: string): Promise<AttachmentRow | null> {
    const a = this.s.attachments.find(
      (x) => x.thread_id === threadId && x.attachment_id === attachmentId && this.mine(x),
    );
    return a ? structuredClone(a) : null;
  }

  async insertRetraction(row: RetractionRow): Promise<void> {
    this.s.retractions.push(structuredClone(row));
  }

  async insertAck(row: AckRow): Promise<void> {
    this.s.acks.push(structuredClone(row));
  }

  async getAck(messageId: string, actorId: string): Promise<AckRow | null> {
    const a = this.s.acks.find(
      (x) => x.message_id === messageId && x.actor_id === actorId && this.mine(x),
    );
    return a ? structuredClone(a) : null;
  }

  async upsertReadReceipt(params: {
    threadId: string;
    actorId: string;
    lastReadSequence: number;
    readAt: string;
  }): Promise<void> {
    const existing = this.s.receipts.find(
      (r) =>
        r.thread_id === params.threadId &&
        r.actor_id === params.actorId &&
        r.tenant_id === this.session.tenantId,
    );
    if (existing) {
      existing.last_read_sequence = Math.max(existing.last_read_sequence, params.lastReadSequence);
      existing.read_at = params.readAt;
      return;
    }
    this.s.receipts.push({
      tenant_id: this.session.tenantId,
      thread_id: params.threadId,
      actor_id: params.actorId,
      last_read_sequence: params.lastReadSequence,
      read_at: params.readAt,
    });
  }

  async listReadReceipts(threadId: string): Promise<ReadReceiptRow[]> {
    return this.s.receipts
      .filter((r) => r.thread_id === threadId && r.tenant_id === this.session.tenantId)
      .map(({ tenant_id: _t, ...rest }) => structuredClone(rest));
  }

  async insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void> {
    if (this.owner.hooks.onOutbox) await this.owner.hooks.onOutbox(envelope, topic);
    const tenant = envelope.tenant_id;
    if (typeof tenant !== 'string') throw new Cmp026Error('SF-SYS-001');
    this.s.outbox.push({ tenant_id: tenant, topic, envelope });
  }
}
