import { describe, expect, it } from 'vitest';
import { Cmp026Error } from '../../src/errors.js';
import { envelopeOf } from '../../src/events.js';
import { PgMessagingStore, type SqlClient, type SqlQueryResult } from '../../src/store/pg-store.js';
import type { DbSession, MessagingTx } from '../../src/store/types.js';
import { ctx, CITIZEN, OFFICER, T1 } from '../doubles/fixtures.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CORR = '22222222-2222-4222-8222-222222222222';
const TS = new Date('2026-10-06T12:00:00.000Z');

class FakeClient implements SqlClient {
  readonly calls: { text: string; values?: unknown[] }[] = [];
  failNext: unknown = null;
  queue: SqlQueryResult[] = [];
  fallback: SqlQueryResult = { rows: [], rowCount: 0 };
  released = false;
  async query(text: string, values?: unknown[]): Promise<SqlQueryResult> {
    this.calls.push(values === undefined ? { text } : { text, values });
    if (
      text === 'BEGIN' ||
      text === 'COMMIT' ||
      text === 'ROLLBACK' ||
      text.startsWith('SELECT set_config')
    ) {
      if (text === 'ROLLBACK' && this.failRollback) throw new Error('rollback failed');
      return { rows: [], rowCount: 0 };
    }
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return this.queue.shift() ?? this.fallback;
  }
  failRollback = false;
  release(): void {
    this.released = true;
  }
}

const session: DbSession = {
  tenantId: T1,
  cellId: 'cell-01',
  actorType: 'OFFICER',
  actorId: OFFICER,
  correlationId: CORR,
};

async function withTx<T>(c: FakeClient, fn: (tx: MessagingTx) => Promise<T>): Promise<T> {
  return new PgMessagingStore({ connect: async () => c }).withTx(session, fn);
}

const threadRow = {
  thread_id: ID,
  tenant_id: T1,
  cell_id: 'cell-01',
  application_id: ID,
  subject_code: null,
  status: 'OPEN',
  aggregate_version: '1',
  message_seq: '2',
  organisation_id: null,
  jurisdiction_id: null,
  created_by: OFFICER,
  created_at: TS,
  updated_at: TS.toISOString(),
  last_correlation_id: CORR,
};

describe('PgMessagingStore', () => {
  it('applies SF-CON-DB-SESSION-CONTEXT in a transaction and releases the connection', async () => {
    const c = new FakeClient();
    await withTx(c, async () => true);
    const sets = c.calls
      .filter((x) => x.text.startsWith('SELECT set_config'))
      .map((x) => x.values?.[0]);
    expect(sets).toEqual([
      'app.tenant_id',
      'app.cell_id',
      'app.actor_type',
      'app.actor_id',
      'app.correlation_id',
    ]);
    expect(c.calls[0]?.text).toBe('BEGIN');
    expect(c.calls.at(-1)?.text).toBe('COMMIT');
    expect(c.released).toBe(true);
  });

  it('rolls back, maps database errors and releases on failure (even if rollback fails)', async () => {
    const c = new FakeClient();
    c.failRollback = true;
    const err = await withTx(c, async () => {
      throw Object.assign(new Error('boom'), { code: '42501' });
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cmp026Error);
    expect((err as Cmp026Error).code).toBe('SF-TEN-002');
    expect(c.calls.some((x) => x.text === 'ROLLBACK')).toBe(true);
    expect(c.released).toBe(true);
  });

  it('maps rows for threads, transitions, participants, messages and attachments', async () => {
    const c = new FakeClient();
    await withTx(c, async (tx) => {
      c.queue.push({ rows: [threadRow], rowCount: 1 });
      const t = await tx.getThread(ID);
      expect(t).toMatchObject({
        aggregate_version: 1,
        message_seq: 2,
        created_at: TS.toISOString(),
      });
      c.queue.push({ rows: [threadRow], rowCount: 1 });
      expect(await tx.getThread(ID, { forUpdate: true })).not.toBeNull();
      expect(c.calls.at(-1)?.text).toMatch(/FOR UPDATE$/);
      c.queue.push({ rows: [], rowCount: 0 });
      expect(await tx.getThread(ID)).toBeNull();
      c.queue.push({ rows: [threadRow], rowCount: 1 });
      expect(await tx.listThreadsForActor(ID, OFFICER)).toHaveLength(1);

      c.queue.push({
        rows: [
          {
            transition_id: ID,
            tenant_id: T1,
            thread_id: ID,
            command: 'CLOSE',
            from_status: 'OPEN',
            to_status: 'CLOSED',
            aggregate_version: '2',
            idempotency_key: 'idem-key-0001',
            authz_decision_id: ID,
            authz_policy_revision: 'r1',
            correlation_id: CORR,
            actor_type: 'OFFICER',
            actor_id: OFFICER,
            occurred_at: TS,
          },
        ],
        rowCount: 1,
      });
      expect((await tx.listTransitions(ID))[0]).toMatchObject({
        aggregate_version: 2,
        to_status: 'CLOSED',
      });

      c.queue.push({
        rows: [
          {
            participant_id: ID,
            tenant_id: T1,
            thread_id: ID,
            actor_id: CITIZEN,
            participant_ref: 'p-1',
            role_code: 'APPLICANT',
            added_by: OFFICER,
            added_at: TS,
            removed_at: null,
            removed_by: null,
          },
        ],
        rowCount: 1,
      });
      expect(await tx.getParticipantByActor(ID, CITIZEN)).toMatchObject({ removed_at: null });
      c.queue.push({ rows: [], rowCount: 0 });
      expect(await tx.getParticipantByActor(ID, CITIZEN)).toBeNull();
      c.queue.push({
        rows: [
          {
            participant_id: ID,
            tenant_id: T1,
            thread_id: ID,
            actor_id: CITIZEN,
            participant_ref: 'p-1',
            role_code: 'APPLICANT',
            added_by: OFFICER,
            added_at: TS,
            removed_at: TS,
            removed_by: OFFICER,
          },
        ],
        rowCount: 1,
      });
      expect((await tx.listParticipants(ID))[0]?.removed_at).toBe(TS.toISOString());
      c.queue.push({ rows: [{ n: 3 }], rowCount: 1 });
      expect(await tx.countActiveParticipants(ID)).toBe(3);

      const messageRow = {
        message_id: ID,
        tenant_id: T1,
        thread_id: ID,
        sequence: '4',
        kind: 'OFFICIAL_NOTICE',
        sender_actor_type: 'OFFICER',
        sender_id: OFFICER,
        sender_participant_ref: 'p-2',
        body_text: 'synthetic',
        body_sha256: `sha256:${'a'.repeat(64)}`,
        ack_required: true,
        ack_due_at: TS,
        created_at: TS,
        correlation_id: CORR,
        retracted_at: null,
        ack_count: '2',
      };
      c.queue.push({ rows: [messageRow], rowCount: 1 });
      expect(await tx.getMessage(ID, ID)).toMatchObject({
        sequence: 4,
        ack_required: true,
        ack_count: 2,
        retracted_at: null,
      });
      c.queue.push({ rows: [], rowCount: 0 });
      expect(await tx.getMessage(ID, ID)).toBeNull();
      c.queue.push({
        rows: [{ ...messageRow, retracted_at: TS, ack_required: false, ack_due_at: null }],
        rowCount: 1,
      });
      const listed = await tx.listMessages({ threadId: ID, afterSequence: 1, limit: 5 });
      expect(listed[0]).toMatchObject({ retracted_at: TS.toISOString(), ack_due_at: null });
      expect(c.calls.at(-1)?.values).toEqual([ID, 1, 5]);

      const attachmentRow = {
        attachment_id: ID,
        tenant_id: T1,
        thread_id: ID,
        message_id: ID,
        storage_key: 'tenant/11111111/objects/abc',
        byte_size: '99',
        checksum_sha256: `sha256:${'b'.repeat(64)}`,
        scan_verdict: 'CLEAN',
        created_at: TS,
      };
      c.queue.push({ rows: [attachmentRow], rowCount: 1 });
      expect((await tx.listAttachments(ID))[0]).toMatchObject({ byte_size: 99 });
      c.queue.push({ rows: [attachmentRow], rowCount: 1 });
      expect(await tx.listAttachments(ID, [ID])).toHaveLength(1);
      expect(c.calls.at(-1)?.values).toEqual([ID, [ID]]);
      c.queue.push({ rows: [attachmentRow], rowCount: 1 });
      expect(await tx.getAttachment(ID, ID)).not.toBeNull();
      c.queue.push({ rows: [], rowCount: 0 });
      expect(await tx.getAttachment(ID, ID)).toBeNull();

      c.queue.push({
        rows: [
          {
            ack_id: ID,
            tenant_id: T1,
            thread_id: ID,
            message_id: ID,
            actor_id: CITIZEN,
            acknowledged_at: TS,
            correlation_id: CORR,
          },
        ],
        rowCount: 1,
      });
      expect(await tx.getAck(ID, CITIZEN)).toMatchObject({ actor_id: CITIZEN });
      c.queue.push({ rows: [], rowCount: 0 });
      expect(await tx.getAck(ID, CITIZEN)).toBeNull();
      c.queue.push({
        rows: [{ thread_id: ID, actor_id: CITIZEN, last_read_sequence: '3', read_at: TS }],
        rowCount: 1,
      });
      expect(await tx.listReadReceipts(ID)).toEqual([
        { thread_id: ID, actor_id: CITIZEN, last_read_sequence: 3, read_at: TS.toISOString() },
      ]);
    });
  });

  it('writes with tenant-bound parameters and honest row counts', async () => {
    const c = new FakeClient();
    await withTx(c, async (tx) => {
      await tx.insertThread({
        ...threadRow,
        status: 'OPEN',
        aggregate_version: 1,
        message_seq: 0,
        created_at: TS.toISOString(),
      } as never);
      await tx.insertTransition({
        transition_id: ID,
        tenant_id: T1,
        thread_id: ID,
        command: 'OPEN_THREAD',
        from_status: null,
        to_status: 'OPEN',
        aggregate_version: 1,
        idempotency_key: 'idem-key-0001',
        authz_decision_id: ID,
        authz_policy_revision: 'r',
        correlation_id: CORR,
        actor_type: 'OFFICER',
        actor_id: OFFICER,
        occurred_at: TS.toISOString(),
      });
      await tx.insertParticipant({
        participant_id: ID,
        tenant_id: T1,
        thread_id: ID,
        actor_id: OFFICER,
        participant_ref: 'p-1',
        role_code: 'CASE_OFFICER',
        added_by: OFFICER,
        added_at: TS.toISOString(),
        removed_at: null,
        removed_by: null,
      });
      await tx.insertMessage({
        message_id: ID,
        tenant_id: T1,
        thread_id: ID,
        sequence: 1,
        kind: 'MESSAGE',
        sender_actor_type: 'OFFICER',
        sender_id: OFFICER,
        sender_participant_ref: 'p-1',
        body_text: 'x',
        body_sha256: `sha256:${'a'.repeat(64)}`,
        ack_required: false,
        ack_due_at: null,
        created_at: TS.toISOString(),
        correlation_id: CORR,
      });
      await tx.insertAttachment({
        attachment_id: ID,
        tenant_id: T1,
        thread_id: ID,
        message_id: ID,
        storage_key: 'tenant/11111111/objects/abc',
        byte_size: 1,
        checksum_sha256: `sha256:${'b'.repeat(64)}`,
        scan_verdict: 'CLEAN',
        created_at: TS.toISOString(),
      });
      await tx.insertRetraction({
        retraction_id: ID,
        tenant_id: T1,
        thread_id: ID,
        message_id: ID,
        retracted_by: OFFICER,
        reason_code: null,
        retracted_at: TS.toISOString(),
        correlation_id: CORR,
      });
      await tx.insertAck({
        ack_id: ID,
        tenant_id: T1,
        thread_id: ID,
        message_id: ID,
        actor_id: CITIZEN,
        acknowledged_at: TS.toISOString(),
        correlation_id: CORR,
      });
      await tx.upsertReadReceipt({
        threadId: ID,
        actorId: CITIZEN,
        lastReadSequence: 1,
        readAt: TS.toISOString(),
      });
      expect(c.calls.at(-1)?.values?.[0]).toBe(T1);

      c.fallback = { rows: [], rowCount: 1 };
      expect(
        await tx.updateThreadStatus({
          threadId: ID,
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          fromVersion: 1,
          updatedAt: TS.toISOString(),
          correlationId: CORR,
        }),
      ).toBe(true);
      expect(
        await tx.removeParticipant({
          threadId: ID,
          actorId: CITIZEN,
          removedBy: OFFICER,
          removedAt: TS.toISOString(),
        }),
      ).toBe(true);
      c.fallback = { rows: [], rowCount: 0 };
      expect(
        await tx.updateThreadStatus({
          threadId: ID,
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          fromVersion: 1,
          updatedAt: TS.toISOString(),
          correlationId: CORR,
        }),
      ).toBe(false);
      expect(
        await tx.removeParticipant({
          threadId: ID,
          actorId: CITIZEN,
          removedBy: OFFICER,
          removedAt: TS.toISOString(),
        }),
      ).toBe(false);

      c.queue.push({ rows: [{ message_seq: '7' }], rowCount: 1 });
      expect(
        await tx.nextMessageSequence({
          threadId: ID,
          updatedAt: TS.toISOString(),
          correlationId: CORR,
        }),
      ).toBe(7);
      c.queue.push({ rows: [], rowCount: 0 });
      expect(
        await tx.nextMessageSequence({
          threadId: ID,
          updatedAt: TS.toISOString(),
          correlationId: CORR,
        }),
      ).toBeNull();
    });
  });

  it('inserts outbox rows with aggregate or audit partition keys', async () => {
    const c = new FakeClient();
    const x = ctx(T1, 'OFFICER', OFFICER);
    await withTx(c, async (tx) => {
      const env = envelopeOf({
        eventType: 'CaseMessageSent',
        ctx: x,
        aggregateId: ID,
        aggregateVersion: 1,
        occurredAt: TS.toISOString(),
        data: {},
      });
      await tx.insertOutbox(env, 'sf.messaging.events.v1');
      expect(c.calls.at(-1)?.values?.[3]).toBe(ID);
      const audit = envelopeOf({
        eventType: 'AuditEventSubmitted',
        ctx: x,
        aggregateId: ID,
        aggregateVersion: 1,
        occurredAt: TS.toISOString(),
        data: { audit_id: CORR },
      });
      await tx.insertOutbox(audit, 'sf.audit.ingest.v1');
      expect(c.calls.at(-1)?.values?.[3]).toBe(`audit:${CORR}`);
      const bare = envelopeOf({
        eventType: 'AuditEventSubmitted',
        ctx: x,
        aggregateId: ID,
        aggregateVersion: 1,
        occurredAt: TS.toISOString(),
        data: {},
      });
      await tx.insertOutbox(bare, 'sf.audit.ingest.v1');
      expect(c.calls.at(-1)?.values?.[3]).toBe(`audit:${ID}`);
    });
  });

  it('idempotency: claim, replay, in-progress conflict, fingerprint mismatch, complete', async () => {
    const c = new FakeClient();
    const ref = { principalId: OFFICER, endpoint: 'POST /v1/threads', key: 'idem-key-0001' };
    const fp = `sha256:${'c'.repeat(64)}`;
    await withTx(c, async (tx) => {
      c.queue.push({ rows: [], rowCount: 1 });
      expect(await tx.claimIdempotency({ ...ref, fingerprint: fp, now: TS })).toBe('claimed');
      expect(c.calls.at(-1)?.values?.[0]).toBe(T1);

      c.queue.push({ rows: [], rowCount: 0 });
      c.queue.push({
        rows: [
          {
            request_fingerprint: fp,
            status: 'COMPLETED',
            response_status: 201,
            response_body: { ok: true },
          },
        ],
        rowCount: 1,
      });
      expect(await tx.claimIdempotency({ ...ref, fingerprint: fp, now: TS })).toEqual({
        status: 201,
        body: { ok: true },
      });

      c.queue.push({ rows: [], rowCount: 0 });
      c.queue.push({
        rows: [
          {
            request_fingerprint: fp,
            status: 'IN_PROGRESS',
            response_status: null,
            response_body: null,
          },
        ],
        rowCount: 1,
      });
      await expect(tx.claimIdempotency({ ...ref, fingerprint: fp, now: TS })).rejects.toMatchObject(
        { code: 'SF-APP-002' },
      );

      c.queue.push({ rows: [], rowCount: 0 });
      c.queue.push({
        rows: [
          {
            request_fingerprint: `sha256:${'d'.repeat(64)}`,
            status: 'COMPLETED',
            response_status: 201,
            response_body: {},
          },
        ],
        rowCount: 1,
      });
      await expect(tx.claimIdempotency({ ...ref, fingerprint: fp, now: TS })).rejects.toMatchObject(
        { code: 'SF-APP-002' },
      );

      c.queue.push({ rows: [], rowCount: 0 });
      c.queue.push({ rows: [], rowCount: 0 });
      await expect(tx.claimIdempotency({ ...ref, fingerprint: fp, now: TS })).rejects.toMatchObject(
        { code: 'SF-SYS-001' },
      );

      c.queue.push({ rows: [], rowCount: 1 });
      await tx.completeIdempotency({ ...ref, response: { status: 201, body: {} } });
      expect(c.calls.at(-1)?.values?.[2]).toBe('{}');
    });
  });
});
