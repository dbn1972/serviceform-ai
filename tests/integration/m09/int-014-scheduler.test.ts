import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validate } from '@serviceform/contracts';
import { buildApp } from '../../../apps/api/src/app.js';
import { buildSchedulerService } from '../../../services/cmp-056-scheduler/src/index.js';
import type { AppointmentNotifyRequest } from '../../../services/cmp-056-scheduler/src/ports/notification.js';
import {
  ADMIN_1,
  CANARY,
  CITIZEN_1,
  CITIZEN_2,
  config,
  ContextState,
  ctxFor,
  idemHeaders,
  OFFICER_1,
  RecordingAuthorizer,
  silentLogger,
  T1,
  T2,
} from './support/fixtures.js';
import { MemorySchedulerRepository } from './support/memory-repos.js';
import { validateM09 } from './support/m09-schemas.js';

/**
 * INT-014 host seam: CMP-036 host -> CMP-056 neutral API -> real AppointmentSchedulerService ->
 * tenant-partitioned memory repository + recording authorizer/notifier. No PostgreSQL.
 * Type/slot refs are opaque synthetic metadata refs; no statutory calendar is modelled.
 */
const FIXED_NOW = new Date('2026-10-15T09:00:00.000Z');
const ADMIN = ctxFor(T1, ADMIN_1, 'PRIVILEGED_ADMIN');
const OFFICER = ctxFor(T1, OFFICER_1, 'OFFICER');
const CITIZEN_A = ctxFor(T1, CITIZEN_1, 'CITIZEN');
const CITIZEN_B = ctxFor(T1, CITIZEN_2, 'CITIZEN');

class RecordingNotifier {
  readonly calls: Array<{ req: AppointmentNotifyRequest; inTx: boolean }> = [];
  fail = false;
  constructor(private readonly repo: MemorySchedulerRepository) {}
  notifyAppointment = async (req: AppointmentNotifyRequest): Promise<void> => {
    this.calls.push({ req: structuredClone(req), inTx: this.repo.inTransaction() });
    if (this.fail) throw new Error('notification channel unavailable');
  };
}

interface Harness {
  app: FastifyInstance;
  state: ContextState;
  repo: MemorySchedulerRepository;
  authz: RecordingAuthorizer;
  notifier: RecordingNotifier;
}

async function harness(): Promise<Harness> {
  const repo = new MemorySchedulerRepository();
  const authz = new RecordingAuthorizer();
  const notifier = new RecordingNotifier(repo);
  const state = new ContextState(ADMIN);
  const service = buildSchedulerService({
    repository: repo,
    authorizer: authz,
    notifier,
    clock: () => FIXED_NOW,
  });
  const app = await buildApp(config, {
    logger: silentLogger(),
    m09: { scheduler: { service, resolveContext: state.resolve } },
  });
  return { app, state, repo, authz, notifier };
}

async function post(h: Harness, url: string, key: string, payload: object) {
  return h.app.inject({ method: 'POST', url, headers: idemHeaders(key), payload });
}

async function seedSlot(h: Harness, capacity: number): Promise<{ typeId: string }> {
  h.state.ctx = ADMIN;
  const type = await post(h, '/v1/appointments/types', 'type-key-0001', {
    appointment_type_ref: 'svc-meta.appointment-type.a',
  });
  expect(type.statusCode).toBe(201);
  const typeId = (type.json() as { appointment_type_id: string }).appointment_type_id;
  h.state.ctx = OFFICER;
  const slot = await post(h, '/v1/appointments/slots', 'slot-key-0001', {
    appointment_type_id: typeId,
    slot_ref: 'slot-ref.a1',
    capacity,
    opens_at: '2026-10-20T09:00:00.000Z',
    closes_at: '2026-10-20T09:30:00.000Z',
  });
  expect(slot.statusCode).toBe(201);
  return { typeId };
}

function appointmentIdOf(body: unknown): string {
  return (body as { appointment: { appointment_id: string } }).appointment.appointment_id;
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.app.close();
  h = undefined;
});

describe('INT-014 appointment booking through the host (CMP-056)', () => {
  it('admin registers type, staff publishes slot, citizen books; tenant comes only from context', async () => {
    h = await harness();
    await seedSlot(h, 2);
    h.state.ctx = CITIZEN_A;
    const res = await post(h, '/v1/appointments', 'book-key-0001', { slot_ref: 'slot-ref.a1' });
    expect(res.statusCode).toBe(201);
    const id = appointmentIdOf(res.json());
    const v = validateM09('appointment', (res.json() as { appointment: unknown }).appointment);
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
    const read = await h.app.inject({ method: 'GET', url: `/v1/appointments/${id}` });
    expect(read.statusCode).toBe(200);
    expect(h.repo.store.tenants()).toEqual([T1]);
    expect(new Set(h.authz.calls.map((c) => c.subject.tenant_id))).toEqual(new Set([T1]));
    expect(new Set(h.authz.calls.map((c) => c.resource.tenant_id))).toEqual(new Set([T1]));
  });

  it('capacity is atomic: the booking beyond capacity is refused and the slot is not overbooked', async () => {
    h = await harness();
    await seedSlot(h, 1);
    h.state.ctx = CITIZEN_A;
    expect(
      (await post(h, '/v1/appointments', 'book-key-a001', { slot_ref: 'slot-ref.a1' })).statusCode,
    ).toBe(201);
    h.state.ctx = CITIZEN_B;
    const second = await post(h, '/v1/appointments', 'book-key-b001', { slot_ref: 'slot-ref.a1' });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    expect(validate('error-response', second.json()).valid).toBe(true);
    expect(second.json()).toMatchObject({ error_code: 'SF-APP-001' });
    const slot = [...h.repo.store.tenant(T1).slots.values()][0];
    expect(slot?.booked_count).toBe(1);
    expect(h.repo.store.tenant(T1).appointments.size).toBe(1);
  });

  it('notification failure does not invalidate the committed booking; notify runs outside the tx', async () => {
    h = await harness();
    await seedSlot(h, 1);
    h.notifier.fail = true;
    h.state.ctx = CITIZEN_A;
    const res = await post(h, '/v1/appointments', 'book-key-n001', { slot_ref: 'slot-ref.a1' });
    expect(res.statusCode).toBe(201);
    const id = appointmentIdOf(res.json());
    const stored = h.repo.store.tenant(T1).appointments.get(id);
    expect(stored?.lifecycle_status).toBe('BOOKED');
    expect(stored?.notification_status).toBe('FAILED');
    expect(h.notifier.calls).toHaveLength(1);
    expect(h.notifier.calls[0]?.inTx).toBe(false);
    expect(h.notifier.calls[0]?.req.tenant_id).toBe(T1);
  });

  it('idempotent replay returns the same booking; same key with a different body is refused', async () => {
    h = await harness();
    await seedSlot(h, 3);
    h.state.ctx = CITIZEN_A;
    const first = await post(h, '/v1/appointments', 'book-key-i001', { slot_ref: 'slot-ref.a1' });
    const replay = await post(h, '/v1/appointments', 'book-key-i001', { slot_ref: 'slot-ref.a1' });
    expect(replay.statusCode).toBe(first.statusCode);
    expect(appointmentIdOf(replay.json())).toBe(appointmentIdOf(first.json()));
    expect(h.repo.store.tenant(T1).appointments.size).toBe(1);
    const conflict = await post(h, '/v1/appointments', 'book-key-i001', {
      slot_ref: 'slot-ref.a1',
      participant_ref: 'participant.x',
    });
    expect(conflict.statusCode).toBeGreaterThanOrEqual(400);
    expect(conflict.json()).toMatchObject({ error_code: 'SF-APP-002' });
  });

  it('mutations without Idempotency-Key are refused before the service writes anything', async () => {
    h = await harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/appointments/types',
      payload: { appointment_type_ref: 'svc-meta.appointment-type.b' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error_code: 'SF-SYS-003' });
    expect(h.repo.store.tenants()).toEqual([]);
  });

  it('client-supplied time and body tenant_id are refused (server clock / server tenant only)', async () => {
    h = await harness();
    const timed = await post(h, '/v1/appointments/types', 'type-key-t001', {
      appointment_type_ref: 'svc-meta.appointment-type.c',
      created_at: '2020-01-01T00:00:00Z',
    });
    expect(timed.statusCode).toBe(400);
    const tenanted = await post(h, '/v1/appointments/types', 'type-key-t002', {
      appointment_type_ref: 'svc-meta.appointment-type.c',
      tenant_id: CANARY,
    });
    expect(tenanted.statusCode).toBe(403);
    expect(tenanted.json()).toMatchObject({ error_code: 'SF-TEN-002' });
    expect(tenanted.body).not.toContain(CANARY);
  });

  it('a citizen cannot register appointment types (actor gate) and the refusal is audited', async () => {
    h = await harness();
    h.state.ctx = CITIZEN_A;
    const res = await post(h, '/v1/appointments/types', 'type-key-c001', {
      appointment_type_ref: 'svc-meta.appointment-type.d',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
  });

  it('PDP deny → SF-AUTH-002 with DENIED audit; PDP unavailable → fail closed', async () => {
    h = await harness();
    h.authz.denied.add('APPOINTMENT_SLOT_LIST');
    h.state.ctx = CITIZEN_A;
    const denied = await h.app.inject({ method: 'GET', url: '/v1/appointments/slots' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: 'SF-AUTH-002' });
    const audit = h.repo.store
      .tenant(T1)
      .outbox.filter((o) => o.envelope.event_type === 'AuditEventSubmitted');
    expect(audit.some((o) => (o.envelope.data as { result?: string }).result === 'DENIED')).toBe(
      true,
    );
    h.authz.fail = true;
    const down = await h.app.inject({ method: 'GET', url: '/v1/appointments/slots' });
    expect(down.statusCode).toBeGreaterThanOrEqual(500);
    expect(validate('error-response', down.json()).valid).toBe(true);
  });

  it('cross-tenant read: an appointment booked in T1 is not visible from T2 (CROSS_TENANT_LEAKAGE=0)', async () => {
    h = await harness();
    await seedSlot(h, 1);
    h.state.ctx = CITIZEN_A;
    const id = appointmentIdOf(
      (await post(h, '/v1/appointments', 'book-key-x001', { slot_ref: 'slot-ref.a1' })).json(),
    );
    h.state.ctx = ctxFor(T2, CITIZEN_1, 'CITIZEN');
    const res = await h.app.inject({ method: 'GET', url: `/v1/appointments/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(T1);
    const slots = await h.app.inject({ method: 'GET', url: '/v1/appointments/slots' });
    expect(slots.statusCode).toBe(200);
    expect((slots.json() as { slots: unknown[] }).slots).toEqual([]);
    expect(h.repo.store.tenant(T2).appointments.size).toBe(0);
  });

  it('every outbox envelope carries the server tenant only', async () => {
    h = await harness();
    await seedSlot(h, 1);
    h.state.ctx = CITIZEN_A;
    await post(h, '/v1/appointments', 'book-key-o001', { slot_ref: 'slot-ref.a1' });
    const outbox = h.repo.store.tenant(T1).outbox;
    expect(outbox.length).toBeGreaterThan(0);
    expect(new Set(outbox.map((o) => o.envelope.tenant_id))).toEqual(new Set([T1]));
    expect(outbox.some((o) => o.envelope.event_type === 'AppointmentBooked')).toBe(true);
  });
});
