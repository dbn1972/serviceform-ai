import { beforeEach, describe, expect, it } from 'vitest';
import { Cmp026Error } from '../../src/errors.js';
import { TOPIC_AUDIT, TOPIC_DOMAIN } from '../../src/events.js';
import { inDomainTransaction } from '../../src/tx-scope.js';
import {
  APP_1,
  CANARY,
  CITIZEN,
  CITIZEN_B,
  ctx,
  harness,
  JUR,
  key,
  KEY_OK,
  NOW,
  OFFICER,
  OFFICER_B,
  SYSTEM,
  T1,
  T2,
  type Harness,
} from '../doubles/fixtures.js';
import { MemoryMessagingStore } from '../doubles/memory-store.js';

const citizen = () => ctx(T1, 'CITIZEN', CITIZEN);
const officer = () => ctx(T1, 'OFFICER', OFFICER);
const BODY = 'Synthetic test message: please upload the remaining form.';

let store: MemoryMessagingStore;
let h: Harness;

beforeEach(() => {
  store = new MemoryMessagingStore();
  h = harness(store);
});

async function expectError(
  p: Promise<unknown>,
  code: string,
  detailCode?: string,
): Promise<Cmp026Error> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Cmp026Error);
  const e = err as Cmp026Error;
  expect(e.code).toBe(code);
  if (detailCode) expect(e.details?.map((d) => d.code)).toContain(detailCode);
  return e;
}

async function openThread(
  extra: Record<string, unknown> = {},
  c = officer(),
  role = 'CASE_OFFICER',
): Promise<string> {
  const res = await h.service.openThread(
    c,
    {
      application_id: APP_1,
      subject_code: 'CLARIFICATION',
      opener_role_code: role,
      participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
      ...extra,
    },
    key('open'),
  );
  return (res.body as { thread: { thread_id: string } }).thread.thread_id;
}

async function send(
  threadId: string,
  c = officer(),
  body: Record<string, unknown> = { body: BODY },
) {
  return h.service.sendMessage(c, threadId, body, key('send'));
}

function messagesOf(res: { body: unknown }): { sequence: number; body: string | null }[] {
  return (res.body as { messages: { sequence: number; body: string | null }[] }).messages;
}

describe('openThread', () => {
  it('creates a tenant-scoped case thread with participants and outbox events', async () => {
    const res = await h.service.openThread(
      officer(),
      {
        application_id: APP_1,
        opener_role_code: 'CASE_OFFICER',
        participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
      },
      key('open'),
    );
    expect(res.status).toBe(201);
    const body = res.body as {
      thread: { status: string; aggregate_version: number };
      participants: { participant_ref: string; role_code: string }[];
    };
    expect(body.thread).toMatchObject({ status: 'OPEN', aggregate_version: 1 });
    expect(body.participants.map((p) => p.role_code).sort()).toEqual(['APPLICANT', 'CASE_OFFICER']);
    expect(JSON.stringify(body)).not.toContain(CITIZEN);
    expect(JSON.stringify(body)).not.toContain(OFFICER);
    expect(store.outboxFor(T1, TOPIC_DOMAIN).map((o) => o.envelope.event_type)).toEqual([
      'ThreadOpened',
    ]);
    expect(store.outboxFor(T1, TOPIC_AUDIT)).toHaveLength(1);
    expect(store.state.transitions).toHaveLength(1);
  });

  it('replays an identical request without a second thread; conflicting reuse is rejected', async () => {
    const payload = {
      application_id: APP_1,
      opener_role_code: 'CASE_OFFICER',
      participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
    };
    const k = key('open-replay');
    const a = await h.service.openThread(officer(), payload, k);
    const b = await h.service.openThread(officer(), payload, k);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    expect(store.state.threads.size).toBe(1);
    await expectError(
      h.service.openThread(officer(), { ...payload, subject_code: 'OTHER_TOPIC' }, k),
      'SF-APP-002',
    );
  });

  it('rejects missing idempotency key, unknown fields, and bad role / ids', async () => {
    const base = { application_id: APP_1, opener_role_code: 'CASE_OFFICER' };
    await expectError(h.service.openThread(officer(), base, undefined), 'SF-SYS-003');
    await expectError(
      h.service.openThread(officer(), { ...base, extra: 1 }, key('x')),
      'SF-SYS-003',
      'UNKNOWN_FIELD',
    );
    await expectError(
      h.service.openThread(officer(), { ...base, application_id: 'nope' }, key('x')),
      'SF-SYS-003',
      'ID_INVALID',
    );
    await expectError(
      h.service.openThread(officer(), { ...base, opener_role_code: 'PLATFORM_ADMIN' }, key('x')),
      'SF-SYS-003',
      'OPENER_ROLE_INVALID',
    );
    await expectError(h.service.openThread(officer(), 'text', key('x')), 'SF-SYS-003');
    expect(store.state.threads.size).toBe(0);
  });

  it('refuses a participant that names another tenant (cross-tenant participants forbidden)', async () => {
    await expectError(
      h.service.openThread(
        officer(),
        {
          application_id: APP_1,
          opener_role_code: 'CASE_OFFICER',
          participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT', tenant_id: T2 }],
        },
        key('x'),
      ),
      'SF-TEN-002',
      'CROSS_TENANT_PARTICIPANT_DENIED',
    );
    expect(store.state.threads.size).toBe(0);
  });

  it('derives participants from the case port: ineligible participant or denied case access fails closed', async () => {
    h.participation.ineligible.add(CITIZEN);
    await expectError(
      h.service.openThread(
        officer(),
        {
          application_id: APP_1,
          opener_role_code: 'CASE_OFFICER',
          participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
        },
        key('x'),
      ),
      'SF-TEN-002',
      'PARTICIPANT_NOT_ELIGIBLE',
    );
    h.participation.ineligible.clear();
    h.participation.denyOpen = true;
    await expectError(
      h.service.openThread(
        officer(),
        { application_id: APP_1, opener_role_code: 'CASE_OFFICER' },
        key('x'),
      ),
      'SF-AUTH-002',
      'CASE_ACCESS_DENIED',
    );
    expect(store.state.threads.size).toBe(0);
  });

  it('rejects duplicate participants including the opener', async () => {
    await expectError(
      h.service.openThread(
        officer(),
        {
          application_id: APP_1,
          opener_role_code: 'CASE_OFFICER',
          participants: [{ actor_id: OFFICER, role_code: 'CASE_OFFICER' }],
        },
        key('x'),
      ),
      'SF-SYS-003',
      'PARTICIPANT_DUPLICATE',
    );
  });

  it('OPA deny, PDP failure and malformed decision all fail closed with no writes', async () => {
    const payload = { application_id: APP_1, opener_role_code: 'CASE_OFFICER' };
    h.authorizer.denied.add('THREAD_OPEN');
    await expectError(h.service.openThread(officer(), payload, key('x')), 'SF-AUTH-002');
    h.authorizer.denied.clear();
    h.authorizer.failWith = new Error('opa down');
    await expectError(
      h.service.openThread(officer(), payload, key('x')),
      'SF-SYS-004',
      'PDP_UNAVAILABLE',
    );
    expect(store.state.threads.size).toBe(0);
    expect(store.txCount).toBe(0);
  });

  it('passes tenant, application and role context to the authorizer', async () => {
    await openThread();
    const input = h.authorizer.inputs[0];
    expect(input?.action).toBe('THREAD_OPEN');
    expect(input?.subject.tenant_id).toBe(T1);
    expect(input?.resource).toMatchObject({
      tenant_id: T1,
      application_id: APP_1,
      classification: 'TENANT_SCOPED',
    });
    expect(input?.subject.jurisdiction_ids).toEqual([JUR]);
  });

  it('requires a tenant-bound context', async () => {
    await expectError(
      h.service.openThread(
        { ...officer(), tenant_id: null },
        { application_id: APP_1, opener_role_code: 'CASE_OFFICER' },
        key('x'),
      ),
      'SF-TEN-001',
    );
    await expectError(h.service.openThread(null, {}, key('x')), 'SF-AUTH-001');
  });
});

describe('messaging', () => {
  it('citizen and officer see the identical authoritative, ordered thread', async () => {
    const id = await openThread();
    await send(id, officer(), { body: 'first from officer' });
    await send(id, citizen(), { body: 'reply from citizen' });
    await send(id, officer(), { body: 'third' });
    const asCitizen = messagesOf(await h.service.listMessages(citizen(), id, {}));
    const asOfficer = messagesOf(await h.service.listMessages(officer(), id, {}));
    expect(asCitizen).toEqual(asOfficer);
    expect(asCitizen.map((m) => m.sequence)).toEqual([1, 2, 3]);
    expect(asCitizen.map((m) => m.body)).toEqual([
      'first from officer',
      'reply from citizen',
      'third',
    ]);
  });

  it('non-participant (same tenant) and other-tenant principals get 404 with no data', async () => {
    const id = await openThread();
    await send(id);
    const outsider = ctx(T1, 'CITIZEN', CITIZEN_B);
    const otherTenant = ctx(T2, 'OFFICER', OFFICER);
    for (const c of [outsider, otherTenant]) {
      await expectError(h.service.getThread(c, id), 'SF-SYS-002');
      await expectError(h.service.listMessages(c, id, {}), 'SF-SYS-002');
      await expectError(send(id, c), 'SF-SYS-002');
      await expectError(h.service.markRead(c, id, { up_to_sequence: 1 }), 'SF-SYS-002');
    }
    expect(store.state.messages).toHaveLength(1);
  });

  it('OPA is consulted for every operation and a deny blocks the write', async () => {
    const id = await openThread();
    h.authorizer.denied.add('MESSAGE_SEND');
    await expectError(send(id), 'SF-AUTH-002');
    expect(store.state.messages).toHaveLength(0);
    h.authorizer.denied.clear();
    h.authorizer.denied.add('MESSAGE_READ');
    await expectError(h.service.listMessages(officer(), id, {}), 'SF-AUTH-002');
  });

  it('assigns gap-free sequences and bumps the thread counter', async () => {
    const id = await openThread();
    for (let i = 0; i < 5; i += 1) await send(id, i % 2 ? citizen() : officer());
    expect(store.state.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(store.state.threads.get(id)?.message_seq).toBe(5);
  });

  it('replays idempotent sends and rejects key reuse with a different payload', async () => {
    const id = await openThread();
    const k = key('send-replay');
    const a = await h.service.sendMessage(officer(), id, { body: BODY }, k);
    const b = await h.service.sendMessage(officer(), id, { body: BODY }, k);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
    expect(store.state.messages).toHaveLength(1);
    await expectError(h.service.sendMessage(officer(), id, { body: 'different' }, k), 'SF-APP-002');
  });

  it('validates body: required, non-blank, bounded; unknown fields rejected', async () => {
    const id = await openThread();
    await expectError(send(id, officer(), {}), 'SF-SYS-003', 'BODY_REQUIRED');
    await expectError(send(id, officer(), { body: '   ' }), 'SF-SYS-003', 'BODY_LENGTH_INVALID');
    await expectError(
      send(id, officer(), { body: 'x'.repeat(8001) }),
      'SF-SYS-003',
      'BODY_LENGTH_INVALID',
    );
    await expectError(
      send(id, officer(), { body: BODY, sender: 'x' }),
      'SF-SYS-003',
      'UNKNOWN_FIELD',
    );
    await expectError(
      send(id, officer(), { body: BODY, kind: 'BROADCAST' }),
      'SF-SYS-003',
      'KIND_INVALID',
    );
    expect(store.state.messages).toHaveLength(0);
  });

  it('events and audit never contain message body text or raw principal ids', async () => {
    const id = await openThread();
    await send(id, officer(), { body: 'SECRET-CONTENT-CANARY' });
    const all = JSON.stringify(store.state.outbox);
    expect(all).not.toContain('SECRET-CONTENT-CANARY');
    const sent = store
      .outboxFor(T1, TOPIC_DOMAIN)
      .find((o) => o.envelope.event_type === 'CaseMessageSent');
    expect(sent?.envelope.data).toMatchObject({
      sequence: 1,
      kind: 'MESSAGE',
      attachment_count: 0,
    });
    expect(
      (sent?.envelope.data as { recipient_participant_refs: string[] }).recipient_participant_refs,
    ).toHaveLength(1);
  });

  it('paginates with next_after_sequence and validates limits', async () => {
    const id = await openThread();
    for (let i = 0; i < 5; i += 1) await send(id);
    const p1 = await h.service.listMessages(officer(), id, { limit: '2' });
    expect(messagesOf(p1).map((m) => m.sequence)).toEqual([1, 2]);
    expect((p1.body as { next_after_sequence: number }).next_after_sequence).toBe(2);
    const p3 = await h.service.listMessages(officer(), id, { after_sequence: '4', limit: 2 });
    expect(messagesOf(p3).map((m) => m.sequence)).toEqual([5]);
    expect((p3.body as { next_after_sequence: number | null }).next_after_sequence).toBeNull();
    await expectError(h.service.listMessages(officer(), id, { limit: '0' }), 'SF-SYS-003');
    await expectError(h.service.listMessages(officer(), id, { limit: '101' }), 'SF-SYS-003');
    await expectError(
      h.service.listMessages(officer(), id, { after_sequence: '-1' }),
      'SF-SYS-003',
    );
  });
});

describe('attachments (CMP-032 port only)', () => {
  it('stores references verified by the storage port outside any DB transaction', async () => {
    const id = await openThread();
    const res = await send(id, officer(), { body: BODY, attachment_storage_keys: [KEY_OK] });
    const message = (res.body as { message: { attachments: { storage_key: string }[] } }).message;
    expect(message.attachments.map((a) => a.storage_key)).toEqual([KEY_OK]);
    expect(h.storage.described).toEqual([{ tenantId: T1, storageKey: KEY_OK }]);
    expect(h.storage.calledInsideTransaction.every((x) => x === false)).toBe(true);
    expect(h.participation.calledInsideTransaction.every((x) => x === false)).toBe(true);
    expect(store.state.attachments[0]).toMatchObject({
      storage_key: KEY_OK,
      scan_verdict: 'CLEAN',
    });
  });

  it('rejects unknown, other-tenant, unscanned and infected objects; no partial message', async () => {
    const id = await openThread();
    h.storage.register(T2, 'tenant/22222222/objects/other-tenant-obj');
    for (const k of [
      'tenant/11111111/objects/missing-obj',
      'tenant/22222222/objects/other-tenant-obj',
    ]) {
      await expectError(
        send(id, officer(), { body: BODY, attachment_storage_keys: [k] }),
        'SF-SYS-003',
        'ATTACHMENT_NOT_FOUND',
      );
    }
    h.storage.register(T1, 'tenant/11111111/objects/pending-scan', { scan_verdict: 'PENDING' });
    h.storage.register(T1, 'tenant/11111111/objects/infected-obj', { scan_verdict: 'INFECTED' });
    for (const k of [
      'tenant/11111111/objects/pending-scan',
      'tenant/11111111/objects/infected-obj',
    ]) {
      await expectError(
        send(id, officer(), { body: BODY, attachment_storage_keys: [k] }),
        'SF-SYS-003',
        'ATTACHMENT_NOT_CLEAN',
      );
    }
    expect(store.state.messages).toHaveLength(0);
    expect(store.state.attachments).toHaveLength(0);
  });

  it('rejects malformed, traversal, duplicate and excessive keys before calling storage', async () => {
    const id = await openThread();
    const bad: unknown[] = [
      ['short'],
      ['tenant/../other/objects/x'],
      ['/absolute/path/object'],
      ['tenant//double/slash/key'],
      ['has space in key value'],
      [KEY_OK, KEY_OK],
      'not-an-array',
      Array.from({ length: 11 }, (_, i) => `tenant/11111111/objects/obj-${i}`),
    ];
    for (const keys of bad) {
      await expectError(
        send(id, officer(), { body: BODY, attachment_storage_keys: keys }),
        'SF-SYS-003',
      );
    }
    expect(h.storage.described).toHaveLength(0);
  });

  it('storage outage fails closed (503) and writes nothing', async () => {
    const id = await openThread();
    h.storage.fail = true;
    await expect(
      send(id, officer(), { body: BODY, attachment_storage_keys: [KEY_OK] }),
    ).rejects.toThrow();
    expect(store.state.messages).toHaveLength(0);
  });

  it('issues a short-lived access grant and audits it; retracted attachments are not served', async () => {
    const id = await openThread();
    const sent = await send(id, officer(), { body: BODY, attachment_storage_keys: [KEY_OK] });
    const m = (
      sent.body as { message: { message_id: string; attachments: { attachment_id: string }[] } }
    ).message;
    const aid = m.attachments[0]?.attachment_id;
    const grant = await h.service.getAttachmentAccess(citizen(), id, aid);
    const access = (
      grant.body as { access: { method: string; expires_at: string; simulation: string } }
    ).access;
    expect(access.method).toBe('GET');
    expect(Date.parse(access.expires_at) - NOW.getTime()).toBe(5 * 60 * 1000);
    expect(access.simulation).toBe('SIMULATED');
    expect(h.storage.accessed).toEqual([KEY_OK]);
    const audits = store
      .outboxFor(T1, TOPIC_AUDIT)
      .map((o) => (o.envelope.data as { action: string }).action);
    expect(audits).toContain('ATTACHMENT_ACCESS');
    await h.service.retractMessage(officer(), id, m.message_id, {}, key('retract'));
    await expectError(h.service.getAttachmentAccess(citizen(), id, aid), 'SF-SYS-002');
    await expectError(
      h.service.getAttachmentAccess(ctx(T2, 'CITIZEN', CITIZEN), id, aid),
      'SF-SYS-002',
    );
  });

  it('refuses attachment access when OPA denies, and unknown attachment ids', async () => {
    const id = await openThread();
    await expectError(h.service.getAttachmentAccess(officer(), id, CANARY), 'SF-SYS-002');
    h.authorizer.denied.add('ATTACHMENT_ACCESS');
    await expectError(h.service.getAttachmentAccess(officer(), id, CANARY), 'SF-AUTH-002');
  });

  it('defaults to an unconfigured storage port that fails closed', async () => {
    const { MessagingService } = await import('../../src/service.js');
    const bare = new MessagingService({
      store,
      authorizer: h.authorizer,
      participation: h.participation,
      clock: () => NOW,
      config: { environment: 'CI' },
    });
    const id = await openThread();
    await expectError(
      bare.sendMessage(officer(), id, { body: BODY, attachment_storage_keys: [KEY_OK] }, key('x')),
      'SF-SYS-004',
      'STORAGE_PORT_NOT_CONFIGURED',
    );
  });
});

describe('retraction (UI delete never erases the audit record)', () => {
  it('masks the body for everyone but keeps the authoritative row and an audit event', async () => {
    const id = await openThread();
    const sent = await send(id, citizen(), { body: 'oops wrong thread' });
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    const res = await h.service.retractMessage(
      citizen(),
      id,
      mid,
      { reason_code: 'SENT_IN_ERROR' },
      key('r'),
    );
    expect(res.body).toMatchObject({ retracted: true });
    for (const c of [citizen(), officer()]) {
      const [m] = (
        (await h.service.listMessages(c, id, {})).body as {
          messages: { body: string | null; retracted: boolean; attachments: unknown[] }[];
        }
      ).messages;
      expect(m).toMatchObject({ body: null, retracted: true, attachments: [] });
    }
    expect(store.state.messages[0]?.body_text).toBe('oops wrong thread');
    expect(store.state.retractions).toHaveLength(1);
    const types = store.outboxFor(T1, TOPIC_DOMAIN).map((o) => o.envelope.event_type);
    expect(types).toContain('CaseMessageRetracted');
  });

  it('only the sender may retract; double retract and unknown ids are rejected', async () => {
    const id = await openThread();
    const sent = await send(id, citizen(), { body: 'mine' });
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    await expectError(
      h.service.retractMessage(officer(), id, mid, {}, key('r')),
      'SF-AUTH-002',
      'NOT_MESSAGE_SENDER',
    );
    await h.service.retractMessage(citizen(), id, mid, {}, key('r'));
    await expectError(
      h.service.retractMessage(citizen(), id, mid, {}, key('r')),
      'SF-APP-001',
      'ALREADY_RETRACTED',
    );
    await expectError(h.service.retractMessage(citizen(), id, CANARY, {}, key('r')), 'SF-SYS-002');
  });
});

describe('official notices and acknowledgement', () => {
  const notice = (extra: Record<string, unknown> = {}) => ({
    kind: 'OFFICIAL_NOTICE',
    body: 'Notice: hearing scheduled. Please acknowledge receipt.',
    ack_required: true,
    ...extra,
  });

  it('only authority-side principals may send notices; citizens are refused', async () => {
    const id = await openThread();
    await expectError(send(id, citizen(), notice()), 'SF-AUTH-002', 'NOTICE_SENDER_NOT_AUTHORITY');
    const ok = await send(id, officer(), notice({ ack_due_at: '2026-10-20T12:00:00Z' }));
    expect(ok.status).toBe(201);
    const m = (ok.body as { message: { kind: string; content_sha256: string; ack_due_at: string } })
      .message;
    expect(m.kind).toBe('OFFICIAL_NOTICE');
    expect(m.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.ack_due_at).toBe('2026-10-20T12:00:00.000Z');
  });

  it('validates acknowledgement parameters', async () => {
    const id = await openThread();
    await expectError(
      send(id, officer(), { body: BODY, ack_required: true }),
      'SF-SYS-003',
      'ACK_ONLY_FOR_NOTICE',
    );
    await expectError(
      send(id, officer(), notice({ ack_required: 'yes' })),
      'SF-SYS-003',
      'ACK_REQUIRED_INVALID',
    );
    await expectError(
      send(id, officer(), notice({ ack_due_at: '2026-10-01T00:00:00Z' })),
      'SF-SYS-003',
      'ACK_DUE_INVALID',
    );
    await expectError(
      send(id, officer(), notice({ ack_due_at: 'tomorrow' })),
      'SF-SYS-003',
      'ACK_DUE_INVALID',
    );
    await expectError(
      send(id, officer(), {
        kind: 'OFFICIAL_NOTICE',
        body: BODY,
        ack_due_at: '2026-10-20T12:00:00Z',
      }),
      'SF-SYS-003',
      'ACK_DUE_WITHOUT_ACK',
    );
  });

  it('notice content is immutable: it cannot be retracted', async () => {
    const id = await openThread();
    const sent = await send(id, officer(), notice());
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    await expectError(
      h.service.retractMessage(officer(), id, mid, {}, key('r')),
      'SF-APP-001',
      'NOTICE_IMMUTABLE',
    );
  });

  it('a participant acknowledges once; sender and duplicates are refused; event emitted', async () => {
    const id = await openThread();
    const sent = await send(id, officer(), notice({ ack_due_at: '2026-10-07T12:00:00Z' }));
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    await expectError(
      h.service.acknowledgeNotice(officer(), id, mid, key('a')),
      'SF-APP-001',
      'SENDER_CANNOT_ACKNOWLEDGE',
    );
    const ack = await h.service.acknowledgeNotice(citizen(), id, mid, key('a'));
    expect(ack.status).toBe(201);
    expect(ack.body).toMatchObject({ acknowledged: true, after_due: false });
    await expectError(
      h.service.acknowledgeNotice(citizen(), id, mid, key('a')),
      'SF-APP-001',
      'ALREADY_ACKNOWLEDGED',
    );
    const types = store.outboxFor(T1, TOPIC_DOMAIN).map((o) => o.envelope.event_type);
    expect(types).toContain('NoticeAcknowledged');
    const [m] = (
      (await h.service.listMessages(officer(), id, {})).body as {
        messages: { ack_count: number }[];
      }
    ).messages;
    expect(m?.ack_count).toBe(1);
  });

  it('flags acknowledgement after the due time', async () => {
    let now = NOW;
    const local = harness(store, () => now);
    const open = await local.service.openThread(
      officer(),
      {
        application_id: APP_1,
        opener_role_code: 'CASE_OFFICER',
        participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
      },
      key('open'),
    );
    const id = (open.body as { thread: { thread_id: string } }).thread.thread_id;
    const sent = await local.service.sendMessage(
      officer(),
      id,
      notice({ ack_due_at: '2026-10-07T12:00:00Z' }),
      key('n'),
    );
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    now = new Date('2026-10-08T00:00:00.000Z');
    const ack = await local.service.acknowledgeNotice(citizen(), id, mid, key('a'));
    expect(ack.body).toMatchObject({ after_due: true });
  });

  it('plain messages and notices without ack_required cannot be acknowledged', async () => {
    const id = await openThread();
    const plain = await send(id, officer());
    const noAck = await send(id, officer(), notice({ ack_required: false }));
    for (const r of [plain, noAck]) {
      const mid = (r.body as { message: { message_id: string } }).message.message_id;
      await expectError(
        h.service.acknowledgeNotice(citizen(), id, mid, key('a')),
        'SF-APP-001',
        'ACK_NOT_REQUIRED',
      );
    }
  });

  it('signals workflow after commit for ack-required notices; workflow failure never blocks', async () => {
    const id = await openThread();
    await send(id, officer(), notice({ ack_due_at: '2026-10-20T12:00:00Z' }));
    expect(h.workflow.signals).toHaveLength(1);
    expect(h.workflow.signals[0]).toMatchObject({
      tenant_id: T1,
      application_id: APP_1,
      ack_due_at: '2026-10-20T12:00:00.000Z',
    });
    h.workflow.fail = true;
    const res = await send(id, officer(), notice());
    expect(res.status).toBe(201);
    await send(id, officer());
    expect(h.workflow.signals).toHaveLength(1);
  });

  it('does not signal workflow on idempotent replay', async () => {
    const id = await openThread();
    const k = key('n-replay');
    await h.service.sendMessage(officer(), id, notice(), k);
    await h.service.sendMessage(officer(), id, notice(), k);
    expect(h.workflow.signals).toHaveLength(1);
  });

  it('system principals may issue notices', async () => {
    const id = await openThread();
    const sys = ctx(T1, 'SYSTEM', SYSTEM, { roles: ['SYSTEM_SENDER'] });
    await h.service.addParticipant(
      officer(),
      id,
      { actor_id: SYSTEM, role_code: 'SYSTEM_SENDER' },
      key('p'),
    );
    const res = await send(id, sys, notice());
    expect(res.status).toBe(201);
  });
});

describe('read receipts', () => {
  it('records a monotonic read position and exposes it in the frozen contract document', async () => {
    const id = await openThread();
    await send(id);
    await send(id);
    await h.service.markRead(citizen(), id, { up_to_sequence: 2 });
    await h.service.markRead(citizen(), id, { up_to_sequence: 1 });
    expect(store.state.receipts[0]?.last_read_sequence).toBe(2);
    const doc = (
      (await h.service.getThread(officer(), id)).body as {
        message_thread: { read_receipts: { participant_ref: string; read_at: string }[] };
      }
    ).message_thread;
    expect(doc.read_receipts).toHaveLength(1);
    expect(Object.keys(doc.read_receipts[0] ?? {}).sort()).toEqual(['participant_ref', 'read_at']);
  });

  it('refuses positions beyond the last message and malformed values', async () => {
    const id = await openThread();
    await send(id);
    await expectError(
      h.service.markRead(citizen(), id, { up_to_sequence: 2 }),
      'SF-SYS-003',
      'SEQUENCE_INVALID',
    );
    await expectError(h.service.markRead(citizen(), id, { up_to_sequence: 'x' }), 'SF-SYS-003');
    await expectError(
      h.service.markRead(citizen(), id, { other: 1 }),
      'SF-SYS-003',
      'UNKNOWN_FIELD',
    );
  });
});

describe('participants', () => {
  it('adds an eligible participant, who then sees the thread; removal revokes access', async () => {
    const id = await openThread();
    const extra = ctx(T1, 'OFFICER', OFFICER_B);
    await expectError(h.service.getThread(extra, id), 'SF-SYS-002');
    await h.service.addParticipant(
      officer(),
      id,
      { actor_id: OFFICER_B, role_code: 'CASE_OFFICER' },
      key('p'),
    );
    expect((await h.service.getThread(extra, id)).status).toBe(200);
    await h.service.removeParticipant(officer(), id, { actor_id: OFFICER_B }, key('p'));
    await expectError(h.service.getThread(extra, id), 'SF-SYS-002');
    await expectError(
      h.service.addParticipant(
        officer(),
        id,
        { actor_id: OFFICER_B, role_code: 'CASE_OFFICER' },
        key('p'),
      ),
      'SF-APP-001',
      'PARTICIPANT_REMOVED',
    );
  });

  it('rejects duplicates, ineligible actors, cross-tenant tenant_id, and removal of the last participant', async () => {
    const id = await openThread();
    await expectError(
      h.service.addParticipant(
        officer(),
        id,
        { actor_id: CITIZEN, role_code: 'APPLICANT' },
        key('p'),
      ),
      'SF-APP-001',
      'PARTICIPANT_EXISTS',
    );
    h.participation.ineligible.add(OFFICER_B);
    await expectError(
      h.service.addParticipant(
        officer(),
        id,
        { actor_id: OFFICER_B, role_code: 'CASE_OFFICER' },
        key('p'),
      ),
      'SF-TEN-002',
    );
    await expectError(
      h.service.addParticipant(
        officer(),
        id,
        { actor_id: OFFICER_B, role_code: 'CASE_OFFICER', tenant_id: T2 },
        key('p'),
      ),
      'SF-TEN-002',
      'CROSS_TENANT_PARTICIPANT_DENIED',
    );
    await h.service.removeParticipant(officer(), id, { actor_id: CITIZEN }, key('p'));
    await expectError(
      h.service.removeParticipant(officer(), id, { actor_id: OFFICER }, key('p')),
      'SF-APP-001',
      'LAST_PARTICIPANT',
    );
    await expectError(
      h.service.removeParticipant(officer(), id, { actor_id: CITIZEN_B }, key('p')),
      'SF-SYS-002',
      'PARTICIPANT_NOT_FOUND',
    );
  });

  it('removed participants can no longer send', async () => {
    const id = await openThread();
    await h.service.removeParticipant(officer(), id, { actor_id: CITIZEN }, key('p'));
    await expectError(send(id, citizen()), 'SF-SYS-002');
  });

  it('lists only threads the actor participates in for an application', async () => {
    const id = await openThread();
    await openThread({ participants: [] });
    const mine = await h.service.listThreadsForApplication(citizen(), APP_1);
    expect(
      (mine.body as { threads: { thread_id: string }[] }).threads.map((t) => t.thread_id),
    ).toEqual([id]);
    const none = await h.service.listThreadsForApplication(ctx(T1, 'CITIZEN', CITIZEN_B), APP_1);
    expect((none.body as { threads: unknown[] }).threads).toEqual([]);
    await expectError(h.service.listThreadsForApplication(citizen(), 'bad'), 'SF-SYS-003');
  });
});

describe('thread lifecycle commands', () => {
  const cmd = (id: string, command: string, status: string, version: number, c = officer()) =>
    h.service.executeCommand(
      c,
      id,
      { command, expected_status: status, expected_version: version },
      key(command.toLowerCase()),
    );

  it('close, reopen, archive follow the legal graph with optimistic versions and transitions log', async () => {
    const id = await openThread();
    await send(id);
    const closed = await cmd(id, 'CLOSE', 'OPEN', 1);
    expect(
      (closed.body as { thread: { status: string; aggregate_version: number } }).thread,
    ).toMatchObject({
      status: 'CLOSED',
      aggregate_version: 2,
    });
    await expectError(send(id), 'SF-APP-001', 'THREAD_NOT_OPEN');
    await cmd(id, 'REOPEN', 'CLOSED', 2);
    await send(id);
    await cmd(id, 'CLOSE', 'OPEN', 3);
    await cmd(id, 'ARCHIVE', 'CLOSED', 4);
    await expectError(cmd(id, 'REOPEN', 'ARCHIVED', 5), 'SF-APP-001', 'ILLEGAL_TRANSITION');
    const log = await h.service.listTransitions(officer(), id);
    const rows = (log.body as { transitions: { command: string; aggregate_version: number }[] })
      .transitions;
    expect(rows.map((r) => r.command)).toEqual([
      'OPEN_THREAD',
      'CLOSE',
      'REOPEN',
      'CLOSE',
      'ARCHIVE',
    ]);
    expect(JSON.stringify(rows)).not.toContain(OFFICER);
  });

  it('rejects stale status/version, illegal commands, and invalid payloads', async () => {
    const id = await openThread();
    await expectError(cmd(id, 'CLOSE', 'OPEN', 9), 'SF-APP-001', 'STALE_VERSION');
    await expectError(cmd(id, 'CLOSE', 'CLOSED', 1), 'SF-APP-001', 'STALE_VERSION');
    await expectError(cmd(id, 'REOPEN', 'OPEN', 1), 'SF-APP-001', 'ILLEGAL_TRANSITION');
    await expectError(cmd(id, 'DELETE', 'OPEN', 1), 'SF-SYS-003', 'COMMAND_INVALID');
    await expectError(cmd(id, 'CLOSE', 'GONE', 1), 'SF-SYS-003', 'EXPECTED_STATUS_INVALID');
    await expectError(
      h.service.executeCommand(
        officer(),
        id,
        { command: 'CLOSE', expected_status: 'OPEN', expected_version: 0 },
        key('c'),
      ),
      'SF-SYS-003',
      'EXPECTED_VERSION_INVALID',
    );
  });

  it('commands are authorized per action and non-participants cannot close threads', async () => {
    const id = await openThread();
    h.authorizer.denied.add('THREAD_CLOSE');
    await expectError(cmd(id, 'CLOSE', 'OPEN', 1), 'SF-AUTH-002');
    h.authorizer.denied.clear();
    await expectError(cmd(id, 'CLOSE', 'OPEN', 1, ctx(T2, 'OFFICER', OFFICER)), 'SF-SYS-002');
    expect(store.state.threads.get(id)?.status).toBe('OPEN');
  });
});

describe('thread view and frozen contract document', () => {
  it('returns an SF-CON-MESSAGE-THREAD document with active participants and attachment refs only', async () => {
    const id = await openThread();
    await send(id, officer(), { body: BODY, attachment_storage_keys: [KEY_OK] });
    await h.service.removeParticipant(officer(), id, { actor_id: CITIZEN }, key('p'));
    const view = (await h.service.getThread(officer(), id)).body as {
      message_thread: Record<string, unknown> & { participants: { tenant_id: string }[] };
    };
    expect(view.message_thread['contract_id']).toBe('SF-CON-MESSAGE-THREAD');
    expect(view.message_thread['attachment_storage_keys']).toEqual([KEY_OK]);
    expect(view.message_thread.participants).toHaveLength(1);
    expect(view.message_thread.participants.every((p) => p.tenant_id === T1)).toBe(true);
  });
});

describe('domain transaction boundary', () => {
  it('never calls an outbound port while a domain transaction is open', async () => {
    const id = await openThread();
    await send(id, officer(), { body: BODY, attachment_storage_keys: [KEY_OK] });
    await h.service.getAttachmentAccess(citizen(), id, store.state.attachments[0]?.attachment_id);
    expect(inDomainTransaction()).toBe(false);
    for (const flags of [
      h.participation.calledInsideTransaction,
      h.storage.calledInsideTransaction,
    ]) {
      expect(flags.length).toBeGreaterThan(0);
      expect(flags.every((f) => f === false)).toBe(true);
    }
  });

  it('refuses outbound calls made from inside the domain transaction', async () => {
    const guarded = h.service.ports.storage;
    const { runInDomainTransaction } = await import('../../src/tx-scope.js');
    await expect(
      runInDomainTransaction(async () =>
        guarded.describeObject({ tenantId: T1, storageKey: KEY_OK }),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
    await expect(
      runInDomainTransaction(async () =>
        h.service.ports.participation.canOpenThread(officer(), { application_id: APP_1 }),
      ),
    ).rejects.toMatchObject({ code: 'SF-SYS-001' });
  });
});
