import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchedulerApi, type ApiResponse } from '../../src/api/handler.js';
import { buildSchedulerService } from '../../src/index.js';
import type { TenantContext } from '../../src/types.js';
import {
  ACTOR_OFFICER,
  AllowAllAuthorizer,
  APPLICATION_ID,
  ctxFor,
  MutableClock,
  slotInput,
  TENANT_A,
  TENANT_B,
} from '../doubles/fixtures.js';
import {
  asSqlPool,
  asTenant,
  closeHarness,
  migrate,
  migrateDown,
  setupHarness,
  type Harness,
} from './helpers.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACTOR = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-10-14T04:00:00.000Z';

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code ?? `error:${String(e)}`;
  }
}

function stack(h: Harness) {
  const authorizer = new AllowAllAuthorizer();
  const clock = new MutableClock(Date.parse(NOW));
  const service = buildSchedulerService({ pool: asSqlPool(h.rt), authorizer, clock: clock.now });
  const ctx: { value: TenantContext } = { value: ctxFor(TENANT_A) };
  const api = createSchedulerApi({ service, resolveContext: () => Promise.resolve(ctx.value) });
  const call = (method: string, path: string, body?: unknown, key?: string): Promise<ApiResponse> =>
    api.handle({
      method,
      path,
      headers: method === 'POST' ? { 'idempotency-key': key ?? `int-key-${randomUUID()}` } : {},
      body,
    });
  const publish = async (slotRef: string, o: Record<string, unknown> = {}): Promise<Body> => {
    const saved = ctx.value;
    ctx.value = ctxFor(saved.tenant_id);
    const res = await call('POST', '/v1/appointment-slots', slotInput(slotRef, o));
    ctx.value = saved;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Body;
  };
  const book = (slotRef: string): Promise<ApiResponse> =>
    call('POST', '/v1/appointments', { slot_ref: slotRef });
  return { call, ctx, clock, authorizer, publish, book };
}

const seatCount = async (h: Harness, tenant: string, slotRef: string): Promise<Body> =>
  (
    await asTenant(h.rt, tenant, ACTOR, (c) =>
      c.query(
        `SELECT s.booked_count,
                (SELECT count(*) FROM sf_scheduler.appointment a
                  WHERE a.slot_id = s.slot_id AND a.lifecycle_status <> 'CANCELLED') AS holding
           FROM sf_scheduler.slot s WHERE s.slot_ref = $1`,
        [slotRef],
      ),
    )
  ).rows[0] as Body;

describe('CMP-056 on PostgreSQL: privilege boundary, FORCE RLS, atomic capacity', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await setupHarness();
  }, 120_000);

  afterAll(async () => {
    await closeHarness(h);
  });

  it('roles are NOLOGIN/NOBYPASSRLS and every tenant table is FORCE RLS, owned by sf_migrator', async () => {
    const roles = await h.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('sf_cmp056_rw', 'sf_t056_rt')`,
    );
    expect(roles.rows).toHaveLength(2);
    for (const r of roles.rows) {
      expect(r['rolsuper']).toBe(false);
      expect(r['rolbypassrls']).toBe(false);
      if (r['rolname'] === 'sf_cmp056_rw') expect(r['rolcanlogin']).toBe(false);
    }
    const tables = await h.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sf_scheduler' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(tables.rows.map((t) => t['relname'])).toEqual([
      'appointment',
      'appointment_event',
      'idempotency_record',
      'inbox_event',
      'inbox_event_platform',
      'notification_outcome',
      'outbox_event',
      'outbox_event_platform',
      'slot',
    ]);
    for (const t of tables.rows) {
      expect(t['owner']).toBe('sf_migrator');
      if (!String(t['relname']).endsWith('_platform')) expect(t['forced']).toBe(true);
    }
    const tableLevel = await h.admin.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'sf_scheduler' AND grantee NOT IN ('sf_migrator', 'sf_outbox_publisher')
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
          AND table_name <> 'idempotency_record'`,
    );
    expect(tableLevel.rows).toEqual([]);
    const columns = await h.admin.query(
      `SELECT table_name, column_name FROM information_schema.column_privileges
        WHERE table_schema = 'sf_scheduler' AND grantee = 'sf_cmp056_rw' AND privilege_type = 'UPDATE'
          AND table_name IN ('slot', 'appointment') ORDER BY 1, 2`,
    );
    expect(
      columns.rows.map((r) => `${String(r['table_name'])}.${String(r['column_name'])}`),
    ).toEqual([
      'appointment.lifecycle_status',
      'appointment.resource_calendar_ref',
      'appointment.slot_id',
      'appointment.slot_ref',
      'appointment.updated_at',
      'appointment.version',
      'slot.booked_count',
      'slot.status',
      'slot.updated_at',
    ]);
  });

  it('books end-to-end through the runtime login and writes outbox rows in the same commit', async () => {
    const s = stack(h);
    await s.publish('slot:int:e2e', { capacity: 2 });
    const res = await s.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:int:e2e', application_id: APPLICATION_ID },
      'int-book-0001',
    );
    expect(res.status).toBe(201);
    const replay = await s.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:int:e2e', application_id: APPLICATION_ID },
      'int-book-0001',
    );
    expect(replay.body).toEqual(res.body);
    const id = (res.body as Body)['appointment_id'] as string;
    expect((await s.call('GET', `/v1/appointments/${id}`)).body).toEqual(res.body);
    expect(await seatCount(h, TENANT_A, 'slot:int:e2e')).toEqual({ booked_count: 1, holding: '1' });
    const producerRead = await code(() =>
      asTenant(h.rt, TENANT_A, ACTOR, (c) => c.query('SELECT 1 FROM sf_scheduler.outbox_event')),
    );
    expect(producerRead).toBe('42501');
    const events = await h.admin.query(
      `SELECT topic, event_type FROM sf_scheduler.outbox_event
        WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY seq`,
      [TENANT_A, id],
    );
    expect(events.rows).toEqual([
      { topic: 'sf.scheduler.events.v1', event_type: 'AppointmentBooked' },
    ]);
    const audits = await h.admin.query(
      `SELECT count(*) AS n FROM sf_scheduler.outbox_event
        WHERE tenant_id = $1 AND topic = 'sf.audit.ingest.v1' AND envelope -> 'data' ->> 'resource_id' = $2`,
      [TENANT_A, id],
    );
    expect(audits.rows[0]?.['n']).toBe('1');
  });

  it('16 concurrent bookings of a single-capacity slot produce exactly one appointment', async () => {
    const s = stack(h);
    await s.publish('slot:int:race-1');
    const results = await Promise.all(Array.from({ length: 16 }, () => s.book('slot:int:race-1')));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((x) => x === 201)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409)).toHaveLength(15);
    for (const r of results.filter((x) => x.status === 409)) {
      expect((r.body as Body)['details']).toEqual([{ code: 'SLOT_CAPACITY_EXHAUSTED' }]);
    }
    expect(await seatCount(h, TENANT_A, 'slot:int:race-1')).toEqual({
      booked_count: 1,
      holding: '1',
    });
    const booked = await h.admin.query(
      `SELECT count(*) AS n FROM sf_scheduler.outbox_event o
         JOIN sf_scheduler.appointment a ON a.appointment_id = o.aggregate_id
         JOIN sf_scheduler.slot sl ON sl.slot_id = a.slot_id
        WHERE sl.slot_ref = 'slot:int:race-1' AND o.event_type = 'AppointmentBooked'`,
    );
    expect(booked.rows[0]?.['n']).toBe('1');
  });

  it('capacity 3 under 12 concurrent bookings admits exactly 3', async () => {
    const s = stack(h);
    await s.publish('slot:int:race-3', { capacity: 3 });
    const results = await Promise.all(Array.from({ length: 12 }, () => s.book('slot:int:race-3')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await seatCount(h, TENANT_A, 'slot:int:race-3')).toEqual({
      booked_count: 3,
      holding: '3',
    });
  });

  it('concurrent reschedules into the last seat move exactly one appointment; the rest stay put', async () => {
    const s = stack(h);
    await s.publish('slot:int:src', { capacity: 4 });
    await s.publish('slot:int:dst', {
      starts_at: '2026-10-22T04:30:00Z',
      ends_at: '2026-10-22T05:00:00Z',
    });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1)
      ids.push(((await s.book('slot:int:src')).body as Body)['appointment_id'] as string);
    const moves = await Promise.all(
      ids.map((id) =>
        s.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:int:dst' }),
      ),
    );
    expect(moves.filter((m) => m.status === 200)).toHaveLength(1);
    expect(moves.filter((m) => m.status === 409)).toHaveLength(3);
    expect(await seatCount(h, TENANT_A, 'slot:int:src')).toEqual({ booked_count: 3, holding: '3' });
    expect(await seatCount(h, TENANT_A, 'slot:int:dst')).toEqual({ booked_count: 1, holding: '1' });
  });

  it('cancel and attendance persist with history; the database refuses illegal changes', async () => {
    const s = stack(h);
    await s.publish('slot:int:life', { capacity: 2 });
    const a = ((await s.book('slot:int:life')).body as Body)['appointment_id'] as string;
    const b = ((await s.book('slot:int:life')).body as Body)['appointment_id'] as string;
    expect((await s.call('POST', `/v1/appointments/${a}/cancel`, {})).status).toBe(200);
    s.clock.set('2026-10-20T04:30:00Z');
    s.ctx.value = ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    expect(
      (await s.call('POST', `/v1/appointments/${b}/attendance`, { outcome: 'COMPLETED' })).status,
    ).toBe(200);
    expect(await seatCount(h, TENANT_A, 'slot:int:life')).toEqual({
      booked_count: 1,
      holding: '1',
    });
    const history = await asTenant(h.rt, TENANT_A, ACTOR, (c) =>
      c.query(
        `SELECT appointment_id, version, from_status, to_status FROM sf_scheduler.appointment_event
          WHERE appointment_id = ANY($1::uuid[]) ORDER BY appointment_id = $2 DESC, version`,
        [[a, b], a],
      ),
    );
    expect(history.rows.map((r) => `${String(r['to_status'])}@${String(r['version'])}`)).toEqual([
      'BOOKED@1',
      'CANCELLED@2',
      'BOOKED@1',
      'COMPLETED@2',
    ]);

    const attempt = (sql: string, values: unknown[] = []): Promise<string> =>
      code(() => asTenant(h.rt, TENANT_A, ACTOR, (c) => c.query(sql, values)));
    expect(
      await attempt(
        `UPDATE sf_scheduler.appointment SET lifecycle_status = 'BOOKED', version = version + 1 WHERE appointment_id = $1`,
        [a],
      ),
    ).toBe('55000');
    expect(
      await attempt(
        `UPDATE sf_scheduler.appointment SET lifecycle_status = 'NO_SHOW', version = version + 1 WHERE appointment_id = $1`,
        [b],
      ),
    ).toBe('55000');
    expect(
      await attempt(
        `UPDATE sf_scheduler.appointment SET booked_by = $2 WHERE appointment_id = $1`,
        [b, randomUUID()],
      ),
    ).toBe('42501');
    expect(
      await attempt(`DELETE FROM sf_scheduler.appointment WHERE appointment_id = $1`, [b]),
    ).toBe('42501');
    expect(
      await attempt(
        `UPDATE sf_scheduler.appointment_event SET to_status = 'NO_SHOW' WHERE appointment_id = $1`,
        [b],
      ),
    ).toBe('42501');
    expect(
      await attempt(`UPDATE sf_scheduler.slot SET capacity = 50 WHERE slot_ref = 'slot:int:life'`),
    ).toBe('42501');
    expect(await attempt(`DELETE FROM sf_scheduler.slot WHERE slot_ref = 'slot:int:life'`)).toBe(
      '42501',
    );
  });

  it('a raw seat change without its appointment, or an appointment without a seat, aborts at commit', async () => {
    const s = stack(h);
    await s.publish('slot:int:raw', { capacity: 2 });
    const attempt = (sql: string, values: unknown[] = []): Promise<string> =>
      code(() => asTenant(h.rt, TENANT_A, ACTOR, (c) => c.query(sql, values)));
    expect(
      await attempt(
        `UPDATE sf_scheduler.slot SET booked_count = 1 WHERE slot_ref = 'slot:int:raw'`,
      ),
    ).toBe('55000');
    expect(
      await attempt(
        `UPDATE sf_scheduler.slot SET booked_count = 3 WHERE slot_ref = 'slot:int:raw'`,
      ),
    ).toBe('23514');
    expect(
      await attempt(
        `INSERT INTO sf_scheduler.appointment (tenant_id, appointment_id, appointment_type_ref, slot_id,
           slot_ref, resource_calendar_ref, lifecycle_status, idempotency_key, version, correlation_id,
           actor_type, booked_by, booked_at, updated_at)
         SELECT tenant_id, $1, appointment_type_ref, slot_id, slot_ref, resource_calendar_ref, 'BOOKED',
                'raw-insert-0001', 1, $1, 'SYSTEM', $1, now(), now()
           FROM sf_scheduler.slot WHERE slot_ref = 'slot:int:raw'`,
        [randomUUID()],
      ),
    ).toBe('55000');
    expect(await seatCount(h, TENANT_A, 'slot:int:raw')).toEqual({ booked_count: 0, holding: '0' });
    await h.admin.query(
      `UPDATE sf_scheduler.slot SET status = 'CLOSED' WHERE slot_ref = 'slot:int:raw'`,
    );
    expect(
      await attempt(`UPDATE sf_scheduler.slot SET status = 'OPEN' WHERE slot_ref = 'slot:int:raw'`),
    ).toBe('55000');
    const closed = await s.book('slot:int:raw');
    expect((closed.body as Body)['details']).toEqual([{ code: 'SLOT_CLOSED' }]);
  });

  it('a FAILED notification outcome is stored append-only and the booking is untouched', async () => {
    const s = stack(h);
    await s.publish('slot:int:notify');
    const booked = await s.book('slot:int:notify');
    const id = (booked.body as Body)['appointment_id'] as string;
    s.ctx.value = ctxFor(TENANT_A, ACTOR, 'INTEGRATION');
    const res = await s.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
      outcome: 'FAILED',
      outcome_ref: 'notify:int-0001',
      failure_code: 'SF-SYS-004',
    });
    expect(res.status).toBe(201);
    expect((res.body as Body)['booking_invalidated']).toBe(false);
    const row = await asTenant(h.rt, TENANT_A, ACTOR, (c) =>
      c.query(
        'SELECT lifecycle_status, version FROM sf_scheduler.appointment WHERE appointment_id = $1',
        [id],
      ),
    );
    expect(row.rows[0]).toEqual({ lifecycle_status: 'BOOKED', version: 1 });
    expect(await seatCount(h, TENANT_A, 'slot:int:notify')).toEqual({
      booked_count: 1,
      holding: '1',
    });
    s.ctx.value = ctxFor(TENANT_A);
    expect((await s.call('GET', `/v1/appointments/${id}`)).body).toEqual(booked.body);
    const tamper = await code(() =>
      asTenant(h.rt, TENANT_A, ACTOR, (c) =>
        c.query(
          `UPDATE sf_scheduler.notification_outcome SET booking_invalidated = true WHERE appointment_id = $1`,
          [id],
        ),
      ),
    );
    expect(tamper).toBe('42501');
  });

  it('tenant B sees none of tenant A rows and cannot write rows for tenant A', async () => {
    const counts = await asTenant(h.rt, TENANT_B, ACTOR, (c) =>
      c.query(
        `SELECT (SELECT count(*) FROM sf_scheduler.slot) AS s,
                (SELECT count(*) FROM sf_scheduler.appointment) AS a,
                (SELECT count(*) FROM sf_scheduler.appointment_event) AS e,
                (SELECT count(*) FROM sf_scheduler.notification_outcome) AS n,
                (SELECT count(*) FROM sf_scheduler.idempotency_record) AS i`,
      ),
    );
    expect(counts.rows[0]).toEqual({ s: '0', a: '0', e: '0', n: '0', i: '0' });
    const forged = await code(() =>
      asTenant(h.rt, TENANT_B, ACTOR, (c) =>
        c.query(
          `INSERT INTO sf_scheduler.slot (tenant_id, slot_id, slot_ref, appointment_type_ref, starts_at,
             ends_at, capacity, actor_type, created_by, correlation_id, created_at, updated_at)
           VALUES ($1,$2,'slot:forged','meta:t',now() + interval '1 day', now() + interval '2 days',1,'SYSTEM',$2,$2,now(),now())`,
          [TENANT_A, randomUUID()],
        ),
      ),
    );
    expect(forged).toBe('42501');
    const crossUpdate = await asTenant(h.rt, TENANT_B, ACTOR, (c) =>
      c.query(`UPDATE sf_scheduler.slot SET status = 'CLOSED' WHERE tenant_id = $1`, [TENANT_A]),
    );
    expect(crossUpdate.rowCount).toBe(0);
    const noTenant = await asTenant(h.rt, null, ACTOR, (c) =>
      c.query('SELECT count(*) AS n FROM sf_scheduler.appointment'),
    );
    expect(noTenant.rows[0]?.['n']).toBe('0');
    const s = stack(h);
    const anyA = await h.admin.query(
      `SELECT appointment_id FROM sf_scheduler.appointment WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_A],
    );
    const idA = String(anyA.rows[0]?.['appointment_id']);
    s.ctx.value = ctxFor(TENANT_B);
    expect((await s.call('GET', `/v1/appointments/${idA}`)).status).toBe(404);
    expect((await s.call('POST', `/v1/appointments/${idA}/cancel`, {})).status).toBe(404);
    expect((await s.book('slot:int:e2e')).status).toBe(404);
    const listed = await s.call('GET', '/v1/appointments/slots');
    expect((listed.body as Body)['slots']).toEqual([]);
  });

  it('a peer component login cannot read sf_scheduler', async () => {
    const probes = [
      'SELECT 1 FROM sf_scheduler.slot',
      'SELECT 1 FROM sf_scheduler.appointment',
      'SELECT 1 FROM sf_scheduler.notification_outcome',
    ];
    for (const sql of probes) {
      const peer = await code(() => asTenant(h.other, TENANT_A, ACTOR, (c) => c.query(sql)));
      expect(peer).toBe('42501');
    }
  });

  it('migrations go down and up again (rollback path)', () => {
    migrateDown(2);
    migrate();
  });
});
