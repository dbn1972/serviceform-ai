import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR,
  asTenant,
  closeHarness,
  CMP026_TABLES,
  participantInsert,
  setupHarness,
  T1,
  T2,
  TABLE_SQL,
  threadInsert,
  type Harness,
} from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await closeHarness(h);
});

const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function newThread(tenant = T1): Promise<{ id: string; ref: string }> {
  const id = randomUUID();
  const [sql, values] = threadInsert(tenant, id);
  await asTenant(h.rt, tenant, (c) => c.query(sql, values));
  const [psql, pvalues] = participantInsert(tenant, id);
  await asTenant(h.rt, tenant, (c) => c.query(psql, pvalues));
  return { id, ref: String(pvalues[4]) };
}

async function sendRaw(
  tenant: string,
  threadId: string,
  ref: string,
  opts: { kind?: string; sequence?: number; ackRequired?: boolean; sender?: string } = {},
): Promise<string> {
  const mid = randomUUID();
  await asTenant(h.rt, tenant, async (c) => {
    const seq = opts.sequence ?? 1;
    await c.query(
      `UPDATE sf_messaging.thread SET message_seq = message_seq + 1, updated_at = now() WHERE thread_id = $1`,
      [threadId],
    );
    await c.query(
      `INSERT INTO sf_messaging.message (
         message_id, tenant_id, thread_id, sequence, kind, sender_actor_type, sender_id,
         sender_participant_ref, body_text, body_sha256, ack_required, created_at, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,'OFFICER',$6,$7,'synthetic body',$8,$9,now(),$10)`,
      [
        mid,
        tenant,
        threadId,
        seq,
        opts.kind ?? 'MESSAGE',
        opts.sender ?? ACTOR,
        ref,
        `sha256:${'a'.repeat(64)}`,
        opts.ackRequired ?? false,
        randomUUID(),
      ],
    );
  });
  return mid;
}

describe('CMP-026 privilege boundary and FORCE RLS (INT-011)', () => {
  it('runtime login is not SUPERUSER, not BYPASSRLS, owns no table', async () => {
    const c = await h.rt.connect();
    try {
      const me = await c.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user`,
      );
      expect(me.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      const owners = await c.query(
        `SELECT bool_or(pg_has_role(session_user, c.relowner, 'MEMBER')) AS owns
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'sf_messaging' AND c.relkind = 'r'`,
      );
      expect(owners.rows[0]?.['owns']).toBe(false);
    } finally {
      c.release();
    }
  });

  it('sf_cmp026_rw is NOLOGIN/NOSUPERUSER/NOBYPASSRLS; every TENANT_SCOPED table is ENABLE+FORCE RLS', async () => {
    const role = await h.admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sf_cmp026_rw'`,
    );
    expect(role.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
    const rls = await h.admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_messaging' AND c.relkind = 'r' ORDER BY 1`,
    );
    const byName = Object.fromEntries(rls.rows.map((r) => [r['relname'], r]));
    for (const t of [...CMP026_TABLES, 'outbox_event', 'inbox_event']) {
      expect({
        t,
        rls: byName[t]?.['relrowsecurity'],
        force: byName[t]?.['relforcerowsecurity'],
      }).toEqual({
        t,
        rls: true,
        force: true,
      });
    }
  });

  it('tenant_id is uuid NOT NULL on every TENANT_SCOPED table', async () => {
    const cols = await h.admin.query(
      `SELECT table_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = 'sf_messaging' AND column_name = 'tenant_id'`,
    );
    expect(cols.rows.length).toBeGreaterThanOrEqual(CMP026_TABLES.length);
    for (const row of cols.rows) {
      if (String(row['table_name']).endsWith('_platform')) continue;
      expect(row['is_nullable']).toBe('NO');
      expect(row['data_type']).toBe('uuid');
    }
  });

  it('own authorized DML succeeds under tenant context', async () => {
    const { id } = await newThread();
    const n = await asTenant(h.rt, T1, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_messaging.thread WHERE thread_id = $1', [id]),
    );
    expect(Number(n.rows[0]?.['n'])).toBe(1);
  });

  it('NEGATIVE: wrong-tenant rows are invisible; cross-tenant inserts fail; no context sees nothing', async () => {
    const { id, ref } = await newThread();
    await sendRaw(T1, id, ref);
    for (const t of ['thread', 'participant', 'message'] as const) {
      const asT2 = await asTenant(h.rt, T2, (c) =>
        c.query('SELECT 1 FROM sf_messaging.' + t + ' WHERE thread_id = $1', [id]),
      );
      expect({ t, rows: asT2.rows }).toEqual({ t, rows: [] });
    }
    const [sql, values] = threadInsert(T1);
    await expect(asTenant(h.rt, T2, (c) => c.query(sql, values))).rejects.toThrow(
      /row-level security/,
    );
    const [psql, pvalues] = participantInsert(T1, id, OTHER);
    await expect(asTenant(h.rt, T2, (c) => c.query(psql, pvalues))).rejects.toThrow();
    const none = await asTenant(h.rt, null, (c) =>
      c.query('SELECT count(*)::int AS n FROM sf_messaging.thread'),
    );
    expect(Number(none.rows[0]?.['n'])).toBe(0);
  });

  it('NEGATIVE: a T2 participant cannot be attached to a T1 thread (tenant-composite FK + RLS)', async () => {
    const { id } = await newThread();
    const [psql, pvalues] = participantInsert(T2, id, OTHER);
    await expect(asTenant(h.rt, T2, (c) => c.query(psql, pvalues))).rejects.toThrow(
      /foreign key|row-level security/,
    );
    await expect(asTenant(h.rt, T1, (c) => c.query(psql, pvalues))).rejects.toThrow(
      /row-level security/,
    );
  });

  it('NEGATIVE: peer component login cannot touch CMP-026 tables', async () => {
    for (const t of CMP026_TABLES) {
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].select1))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asTenant(h.peer, T1, (c) => c.query(TABLE_SQL[t].deleteAll))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('NEGATIVE: sf_app alone holds no DML on authoritative tables; no SET ROLE into peers', async () => {
    const [sql, values] = threadInsert(T1);
    await expect(asTenant(h.appOnly, T1, (c) => c.query(sql, values))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asTenant(h.rt, T1, (c) => c.query('SET ROLE sf_cmp015_rw'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('NEGATIVE: runtime cannot DELETE or TRUNCATE any messaging table', async () => {
    for (const t of CMP026_TABLES) {
      if (t === 'idempotency_record') continue;
      await expect(asTenant(h.rt, T1, (c) => c.query(TABLE_SQL[t].deleteAll))).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(
      asTenant(h.rt, T1, (c) => c.query('TRUNCATE sf_messaging.message')),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('CMP-026 database invariants (defence in depth below the service)', () => {
  it('messages are append-only: UPDATE and DELETE are refused', async () => {
    const { id, ref } = await newThread();
    const mid = await sendRaw(T1, id, ref);
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(`UPDATE sf_messaging.message SET body_text = 'edited' WHERE message_id = $1`, [
          mid,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query('DELETE FROM sf_messaging.message WHERE message_id = $1', [mid]),
      ),
    ).rejects.toThrow(/permission denied/);
    const row = await h.admin.query(
      `SELECT body_text FROM sf_messaging.message WHERE message_id = $1`,
      [mid],
    );
    expect(row.rows[0]?.['body_text']).toBe('synthetic body');
  });

  it('even the owner-trigger refuses mutation of immutable rows', async () => {
    const { id, ref } = await newThread();
    const mid = await sendRaw(T1, id, ref);
    await expect(
      h.admin.query(`UPDATE sf_messaging.message SET body_text = 'edited' WHERE message_id = $1`, [
        mid,
      ]),
    ).rejects.toThrow(/append-only|row-level security|violates/);
  });

  it('thread transitions follow the legal graph; illegal jumps and version skips are refused', async () => {
    const { id } = await newThread();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_messaging.thread SET status = 'ARCHIVED', aggregate_version = 2, updated_at = now() WHERE thread_id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow(/illegal thread transition/);
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_messaging.thread SET status = 'CLOSED', aggregate_version = 5, updated_at = now() WHERE thread_id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow(/advances aggregate_version/);
    await asTenant(h.rt, T1, (c) =>
      c.query(
        `UPDATE sf_messaging.thread SET status = 'CLOSED', aggregate_version = 2, updated_at = now() WHERE thread_id = $1`,
        [id],
      ),
    );
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_messaging.thread SET message_seq = message_seq + 1 WHERE thread_id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow(/not open/);
  });

  it('thread identity columns cannot be rewritten (no UPDATE grant on application_id)', async () => {
    const { id } = await newThread();
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(`UPDATE sf_messaging.thread SET application_id = $2 WHERE thread_id = $1`, [
          id,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('a message cannot be appended to a closed thread, with a stale sequence, or by a non-participant', async () => {
    const { id, ref } = await newThread();
    await expect(sendRaw(T1, id, ref, { sequence: 7 })).rejects.toThrow(
      /not open or sequence is not current/,
    );
    await expect(sendRaw(T1, id, ref, { sender: randomUUID() })).rejects.toThrow(
      /not an active participant/,
    );
    await asTenant(h.rt, T1, (c) =>
      c.query(
        `UPDATE sf_messaging.thread SET status = 'CLOSED', aggregate_version = 2, updated_at = now() WHERE thread_id = $1`,
        [id],
      ),
    );
    await expect(sendRaw(T1, id, ref)).rejects.toThrow(/not open/);
  });

  it('retraction is sender-only, plain-message-only and one-shot; the message row survives', async () => {
    const { id, ref } = await newThread();
    const plain = await sendRaw(T1, id, ref);
    const notice = await sendRaw(T1, id, ref, {
      kind: 'OFFICIAL_NOTICE',
      sequence: 2,
      ackRequired: true,
    });
    const retract = (mid: string, by: string) =>
      asTenant(h.rt, T1, (c) =>
        c.query(
          `INSERT INTO sf_messaging.message_retraction (retraction_id, tenant_id, thread_id, message_id, retracted_by, retracted_at, correlation_id)
           VALUES ($1,$2,$3,$4,$5,now(),$6)`,
          [randomUUID(), T1, id, mid, by, randomUUID()],
        ),
      );
    await expect(retract(plain, randomUUID())).rejects.toThrow(/only the sender/);
    await expect(retract(notice, ACTOR)).rejects.toThrow(/only the sender/);
    await retract(plain, ACTOR);
    await expect(retract(plain, ACTOR)).rejects.toThrow(/duplicate key|unique/);
    const kept = await h.admin.query(
      `SELECT body_text FROM sf_messaging.message WHERE message_id = $1`,
      [plain],
    );
    expect(kept.rows).toHaveLength(1);
  });

  it('acknowledgement applies only to ack-required notices, never by the sender', async () => {
    const { id, ref } = await newThread();
    const plain = await sendRaw(T1, id, ref);
    const notice = await sendRaw(T1, id, ref, {
      kind: 'OFFICIAL_NOTICE',
      sequence: 2,
      ackRequired: true,
    });
    const recipient = randomUUID();
    const [psql, pvalues] = participantInsert(T1, id, recipient);
    await asTenant(h.rt, T1, (c) => c.query(psql, pvalues));
    const ack = (mid: string, actor: string) =>
      asTenant(h.rt, T1, (c) =>
        c.query(
          `INSERT INTO sf_messaging.notice_acknowledgement (ack_id, tenant_id, thread_id, message_id, actor_id, acknowledged_at, correlation_id)
           VALUES ($1,$2,$3,$4,$5,now(),$6)`,
          [randomUUID(), T1, id, mid, actor, randomUUID()],
        ),
      );
    await expect(ack(plain, recipient)).rejects.toThrow(/not an acknowledgeable notice/);
    await expect(ack(notice, ACTOR)).rejects.toThrow(/not an acknowledgeable notice/);
    await expect(ack(notice, randomUUID())).rejects.toThrow(
      /not an acknowledgeable notice|not an active participant/,
    );
    await ack(notice, recipient);
    await expect(ack(notice, recipient)).rejects.toThrow(/duplicate key|unique/);
  });

  it('official notice columns are consistent: ack settings only on notices', async () => {
    const { id, ref } = await newThread();
    await expect(sendRaw(T1, id, ref, { ackRequired: true })).rejects.toThrow(/check constraint/);
  });

  it('read position is monotonic, bounded by the last message, participants only; participants removal is one-way', async () => {
    const { id, ref } = await newThread();
    await sendRaw(T1, id, ref);
    const mark = (seq: number, actor = ACTOR) =>
      asTenant(h.rt, T1, (c) =>
        c.query(
          `INSERT INTO sf_messaging.read_receipt (tenant_id, thread_id, actor_id, last_read_sequence, read_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (tenant_id, thread_id, actor_id) DO UPDATE SET last_read_sequence = EXCLUDED.last_read_sequence, read_at = EXCLUDED.read_at`,
          [T1, id, actor, seq],
        ),
      );
    await expect(mark(5)).rejects.toThrow(/beyond the last message/);
    await expect(mark(1, randomUUID())).rejects.toThrow(/not an active participant/);
    await mark(1);
    await expect(mark(0)).rejects.toThrow(/cannot move backwards/);
    await asTenant(h.rt, T1, (c) =>
      c.query(
        `UPDATE sf_messaging.participant SET removed_at = now(), removed_by = $2 WHERE thread_id = $1`,
        [id, ACTOR],
      ),
    );
    await expect(
      asTenant(h.rt, T1, (c) =>
        c.query(
          `UPDATE sf_messaging.participant SET removed_at = NULL, removed_by = NULL WHERE thread_id = $1`,
          [id],
        ),
      ),
    ).rejects.toThrow(/removal is one-way|check constraint/);
    await expect(sendRaw(T1, id, ref, { sequence: 2 })).rejects.toThrow(
      /not an active participant/,
    );
  });

  it('attachment rows only accept clean storage-key references (no traversal, no inline content)', async () => {
    const { id, ref } = await newThread();
    const mid = await sendRaw(T1, id, ref);
    const attach = (key: string, verdict = 'CLEAN') =>
      asTenant(h.rt, T1, (c) =>
        c.query(
          `INSERT INTO sf_messaging.message_attachment (attachment_id, tenant_id, thread_id, message_id, storage_key, byte_size, checksum_sha256, scan_verdict, created_at)
           VALUES ($1,$2,$3,$4,$5,10,$6,$7,now())`,
          [randomUUID(), T1, id, mid, key, `sha256:${'b'.repeat(64)}`, verdict],
        ),
      );
    await expect(attach('tenant/../x/objects/abc')).rejects.toThrow(/check constraint/);
    await expect(attach('tenant/11111111/objects/ok-key', 'INFECTED')).rejects.toThrow(
      /check constraint/,
    );
    await attach('tenant/11111111/objects/ok-key');
  });
});
