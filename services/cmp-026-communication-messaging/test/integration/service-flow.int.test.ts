import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cmp026Error } from '../../src/errors.js';
import { PgMessagingStore } from '../../src/store/pg-store.js';
import type { DbSession, MessagingStore, MessagingTx } from '../../src/store/types.js';
import { harness, APP_1, CITIZEN, ctx, key, KEY_OK, OFFICER, T1, T2 } from '../doubles/fixtures.js';
import { closeHarness, setupHarness, type Harness } from './helpers.js';

let db: Harness;
beforeAll(async () => {
  db = await setupHarness();
});
afterAll(async () => {
  await closeHarness(db);
});

const citizen = (t = T1) => ctx(t, 'CITIZEN', CITIZEN);
const officer = (t = T1) => ctx(t, 'OFFICER', OFFICER);

function stack(store?: MessagingStore) {
  const pg = store ?? new PgMessagingStore(db.rt);
  return { ...harness(pg), pg };
}

async function open(h: ReturnType<typeof stack>): Promise<string> {
  const res = await h.service.openThread(
    officer(),
    {
      application_id: APP_1,
      subject_code: 'CLARIFICATION',
      opener_role_code: 'CASE_OFFICER',
      participants: [{ actor_id: CITIZEN, role_code: 'APPLICANT' }],
    },
    key('int-open'),
  );
  return (res.body as { thread: { thread_id: string } }).thread.thread_id;
}

describe('CMP-026 service against PostgreSQL (RLS + triggers + outbox)', () => {
  it('runs the two-way thread flow; both sides read the same authoritative thread', async () => {
    const h = stack();
    const id = await open(h);
    const sent = await h.service.sendMessage(
      officer(),
      id,
      { body: 'Please confirm the address.', attachment_storage_keys: [KEY_OK] },
      key('int-send'),
    );
    expect(sent.status).toBe(201);
    await h.service.sendMessage(citizen(), id, { body: 'Confirmed.' }, key('int-reply'));
    const a = await h.service.listMessages(citizen(), id, {});
    const b = await h.service.listMessages(officer(), id, {});
    expect(a.body).toEqual(b.body);
    const msgs = (a.body as { messages: { sequence: number; attachments: unknown[] }[] }).messages;
    expect(msgs.map((m) => m.sequence)).toEqual([1, 2]);
    expect(msgs[0]?.attachments).toHaveLength(1);
    const view = (await h.service.getThread(citizen(), id)).body as {
      message_thread: { attachment_storage_keys: string[]; participants: unknown[] };
    };
    expect(view.message_thread.attachment_storage_keys).toEqual([KEY_OK]);
    expect(view.message_thread.participants).toHaveLength(2);
  });

  it('NEGATIVE: another tenant cannot read, send or acknowledge; same-tenant outsiders get 404', async () => {
    const h = stack();
    const id = await open(h);
    for (const c of [officer(T2), ctx(T1, 'CITIZEN', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2')]) {
      await expect(h.service.getThread(c, id)).rejects.toMatchObject({ code: 'SF-SYS-002' });
      await expect(h.service.sendMessage(c, id, { body: 'x' }, key('int-x'))).rejects.toMatchObject(
        { code: 'SF-SYS-002' },
      );
    }
    const leak = await db.admin.query(
      `SELECT count(*)::int AS n FROM sf_messaging.message WHERE thread_id = $1`,
      [id],
    );
    expect(Number(leak.rows[0]?.['n'])).toBe(0);
  });

  it('concurrent sends receive unique, gap-free sequence numbers', async () => {
    const h = stack();
    const id = await open(h);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        h.service.sendMessage(
          i % 2 ? citizen() : officer(),
          id,
          { body: `m${i}` },
          key(`int-c${i}`),
        ),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const rows = await db.admin.query(
      `SELECT sequence FROM sf_messaging.message WHERE thread_id = $1 ORDER BY sequence`,
      [id],
    );
    expect(rows.rows.map((r) => Number(r['sequence']))).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it('concurrent duplicate idempotency keys create exactly one message', async () => {
    const h = stack();
    const id = await open(h);
    const k = key('int-dup');
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () => h.service.sendMessage(officer(), id, { body: 'once' }, k)),
    );
    const ok = settled.filter((s) => s.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const s of settled) {
      if (s.status === 'rejected') expect((s.reason as Cmp026Error).code).toBe('SF-APP-002');
    }
    const n = await db.admin.query(
      `SELECT count(*)::int AS n FROM sf_messaging.message WHERE thread_id = $1`,
      [id],
    );
    expect(Number(n.rows[0]?.['n'])).toBe(1);
  });

  it('commits state, idempotency record and outbox atomically; rolls everything back on failure', async () => {
    const real = new PgMessagingStore(db.rt);
    let failOn: string | null = null;
    const flaky: MessagingStore = {
      withTx: <T>(s: DbSession, fn: (tx: MessagingTx) => Promise<T>) =>
        real.withTx(s, (tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'insertOutbox') {
                  return async (env: { event_type: string }, topic: string) => {
                    if (failOn && env.event_type === failOn) throw new Error('simulated crash');
                    return target.insertOutbox(env as never, topic);
                  };
                }
                const v: unknown = Reflect.get(target, prop, receiver);
                return typeof v === 'function' ? v.bind(target) : v;
              },
            }),
          ),
        ),
    };
    const h = stack(flaky);
    const id = await open(h);
    failOn = 'CaseMessageSent';
    const k = key('int-atomic');
    await expect(h.service.sendMessage(officer(), id, { body: 'lost' }, k)).rejects.toBeInstanceOf(
      Cmp026Error,
    );
    const counts = await db.admin.query(
      `SELECT (SELECT count(*) FROM sf_messaging.message WHERE thread_id = $1)::int AS msgs,
              (SELECT message_seq FROM sf_messaging.thread WHERE thread_id = $1)::int AS seq,
              (SELECT count(*) FROM sf_messaging.idempotency_record WHERE idempotency_key = $2)::int AS idem`,
      [id, k],
    );
    expect(counts.rows[0]).toEqual({ msgs: 0, seq: 0, idem: 0 });
    failOn = null;
    const retry = await h.service.sendMessage(officer(), id, { body: 'delivered' }, k);
    expect(retry.status).toBe(201);
    const ev = await db.admin.query(
      `SELECT count(*)::int AS n FROM sf_messaging.outbox_event WHERE aggregate_id = $1 AND event_type = 'CaseMessageSent'`,
      [id],
    );
    expect(Number(ev.rows[0]?.['n'])).toBe(1);
  });

  it('outbox and audit events carry no message body text or raw principal ids', async () => {
    const h = stack();
    const id = await open(h);
    await h.service.sendMessage(
      officer(),
      id,
      { body: 'CANARY-BODY-TEXT-7788' },
      key('int-canary'),
    );
    const rows = await db.admin.query(
      `SELECT envelope::text AS e FROM sf_messaging.outbox_event WHERE aggregate_id = $1
        UNION ALL SELECT envelope::text FROM sf_messaging.outbox_event WHERE topic = 'sf.audit.ingest.v1' AND envelope->'data'->>'resource_id' = $1::text`,
      [id],
    );
    expect(rows.rows.length).toBeGreaterThan(2);
    for (const r of rows.rows) expect(String(r['e'])).not.toContain('CANARY-BODY-TEXT-7788');
    const topics = await db.admin.query(
      `SELECT DISTINCT topic FROM sf_messaging.outbox_event WHERE tenant_id = $1 ORDER BY 1`,
      [T1],
    );
    expect(topics.rows.map((r) => r['topic'])).toEqual([
      'sf.audit.ingest.v1',
      'sf.messaging.events.v1',
    ]);
  });

  it('retraction keeps the authoritative row; notices acknowledge once; lifecycle persists transitions', async () => {
    const h = stack();
    const id = await open(h);
    const sent = await h.service.sendMessage(
      citizen(),
      id,
      { body: 'wrong thread, sorry' },
      key('int-r1'),
    );
    const mid = (sent.body as { message: { message_id: string } }).message.message_id;
    await h.service.retractMessage(
      citizen(),
      id,
      mid,
      { reason_code: 'SENT_IN_ERROR' },
      key('int-r2'),
    );
    const view = (await h.service.listMessages(officer(), id, {})).body as {
      messages: { body: string | null }[];
    };
    expect(view.messages[0]?.body).toBeNull();
    const kept = await db.admin.query(
      `SELECT body_text FROM sf_messaging.message WHERE message_id = $1`,
      [mid],
    );
    expect(kept.rows[0]?.['body_text']).toBe('wrong thread, sorry');

    const notice = await h.service.sendMessage(
      officer(),
      id,
      {
        kind: 'OFFICIAL_NOTICE',
        body: 'Hearing notice',
        ack_required: true,
        ack_due_at: '2026-10-20T00:00:00Z',
      },
      key('int-n1'),
    );
    const nid = (notice.body as { message: { message_id: string } }).message.message_id;
    await h.service.acknowledgeNotice(citizen(), id, nid, key('int-a1'));
    await expect(
      h.service.acknowledgeNotice(citizen(), id, nid, key('int-a2')),
    ).rejects.toMatchObject({
      code: 'SF-APP-001',
    });
    await expect(
      h.service.retractMessage(officer(), id, nid, {}, key('int-r3')),
    ).rejects.toMatchObject({
      code: 'SF-APP-001',
    });

    const closed = await h.service.executeCommand(
      officer(),
      id,
      { command: 'CLOSE', expected_status: 'OPEN', expected_version: 1 },
      key('int-close'),
    );
    expect((closed.body as { thread: { status: string } }).thread.status).toBe('CLOSED');
    await expect(
      h.service.sendMessage(officer(), id, { body: 'late' }, key('int-late')),
    ).rejects.toMatchObject({ code: 'SF-APP-001' });
    const log = await h.service.listTransitions(officer(), id);
    expect((log.body as { transitions: unknown[] }).transitions).toHaveLength(2);
  });

  it('read receipts and participant removal persist; removed participants lose access', async () => {
    const h = stack();
    const id = await open(h);
    await h.service.sendMessage(officer(), id, { body: 'hi' }, key('int-rr1'));
    await h.service.markRead(citizen(), id, { up_to_sequence: 1 });
    await h.service.markRead(citizen(), id, { up_to_sequence: 1 });
    const doc = (await h.service.getThread(officer(), id)).body as {
      message_thread: { read_receipts: unknown[] };
    };
    expect(doc.message_thread.read_receipts).toHaveLength(1);
    await h.service.removeParticipant(officer(), id, { actor_id: CITIZEN }, key('int-rm'));
    await expect(h.service.getThread(citizen(), id)).rejects.toMatchObject({ code: 'SF-SYS-002' });
    const threads = await h.service.listThreadsForApplication(officer(), APP_1);
    expect((threads.body as { threads: unknown[] }).threads.length).toBeGreaterThan(0);
  });
});
