import { describe, expect, it } from 'vitest';
import {
  ACTOR_CITIZEN,
  ACTOR_OFFICER,
  APPLICATION_ID,
  ctxFor,
  OTHER_TYPE_REF,
  TENANT_A,
  TYPE_REF,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const errorCode = (b: unknown): string => (b as Body)['error_code'] as string;
const detailCode = (b: unknown): string | undefined =>
  ((b as Body)['details'] as Body[] | undefined)?.[0]?.['code'] as string | undefined;

function citizen(h: Harness, id = ACTOR_CITIZEN): void {
  h.state.ctx = ctxFor(TENANT_A, id, 'CITIZEN');
}

describe('slot publication and listing', () => {
  it('publishes an empty OPEN slot and lists only bookable slots', async () => {
    const h = makeHarness();
    const s = await h.publish('slot:a:1', { capacity: 2 });
    expect(s).toMatchObject({ booked_count: 0, remaining_capacity: 2, status: 'OPEN' });
    await h.publish('slot:a:2', {
      starts_at: '2026-10-21T04:30:00Z',
      ends_at: '2026-10-21T05:00:00Z',
    });
    await h.publish('slot:b:1', { appointment_type_ref: OTHER_TYPE_REF });
    await h.book('slot:a:2');
    const res = await h.call('GET', '/v1/appointments/slots', undefined, {
      query: { appointment_type_ref: TYPE_REF },
    });
    expect(res.status).toBe(200);
    expect(((res.body as Body)['slots'] as Body[]).map((x) => x['slot_ref'])).toEqual(['slot:a:1']);
  });

  it('slots that already started are neither publishable nor listed', async () => {
    const h = makeHarness();
    const past = await h.call('POST', '/v1/appointment-slots', {
      slot_ref: 'slot:past',
      appointment_type_ref: TYPE_REF,
      starts_at: '2026-10-14T03:00:00Z',
      ends_at: '2026-10-14T03:30:00Z',
      capacity: 1,
    });
    expect(detailCode(past.body)).toBe('SLOT_ALREADY_STARTED');
    await h.publish('slot:soon', {
      starts_at: '2026-10-14T05:00:00Z',
      ends_at: '2026-10-14T05:30:00Z',
    });
    h.clock.set('2026-10-14T05:00:00Z');
    const list = await h.call('GET', '/v1/appointments/slots');
    expect((list.body as Body)['slots']).toEqual([]);
  });

  it('re-publishing the same slot_ref is idempotent only for an identical definition', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const same = await h.call('POST', '/v1/appointment-slots', {
      slot_ref: 'slot:a',
      appointment_type_ref: TYPE_REF,
      resource_calendar_ref: 'meta:resource-calendar:synthetic-1',
      jurisdiction_id: '44444444-4444-4444-8444-444444444444',
      starts_at: '2026-10-20T04:30:00Z',
      ends_at: '2026-10-20T05:00:00Z',
      capacity: 1,
    });
    expect(same.status).toBe(200);
    const different = await h.call('POST', '/v1/appointment-slots', {
      slot_ref: 'slot:a',
      appointment_type_ref: TYPE_REF,
      starts_at: '2026-10-20T04:30:00Z',
      ends_at: '2026-10-20T05:00:00Z',
      capacity: 5,
    });
    expect(different.status).toBe(409);
    expect(detailCode(different.body)).toBe('SLOT_REF_CONFLICT');
  });

  it('citizens cannot publish slots', async () => {
    const h = makeHarness();
    citizen(h);
    const res = await h.call('POST', '/v1/appointment-slots', {
      slot_ref: 'slot:c',
      appointment_type_ref: TYPE_REF,
      starts_at: '2026-10-20T04:30:00Z',
      ends_at: '2026-10-20T05:00:00Z',
      capacity: 1,
    });
    expect(res.status).toBe(403);
    expect(h.repo.tenant(TENANT_A).slots.size).toBe(0);
  });
});

describe('atomic capacity', () => {
  it('a single-capacity slot takes exactly one of many concurrent bookings', async () => {
    const h = makeHarness();
    await h.publish('slot:one');
    const results = await Promise.all(Array.from({ length: 8 }, () => h.book('slot:one')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(detailCode(r.body)).toBe('SLOT_CAPACITY_EXHAUSTED');
    }
    const t = h.repo.tenant(TENANT_A);
    expect([...t.slots.values()][0]?.booked_count).toBe(1);
    expect(t.appointments.size).toBe(1);
    expect(t.outbox.filter((o) => o.envelope.event_type === 'AppointmentBooked')).toHaveLength(1);
  });

  it('capacity N admits exactly N bookings; a cancellation frees one seat', async () => {
    const h = makeHarness();
    await h.publish('slot:three', { capacity: 3 });
    const ok = [];
    for (let i = 0; i < 3; i += 1) ok.push(await h.book('slot:three'));
    expect(ok.map((r) => r.status)).toEqual([201, 201, 201]);
    expect((await h.book('slot:three')).status).toBe(409);
    const id = (ok[0]?.body as Body)['appointment_id'] as string;
    expect((await h.call('POST', `/v1/appointments/${id}/cancel`, {})).status).toBe(200);
    expect((await h.book('slot:three')).status).toBe(201);
    expect((await h.book('slot:three')).status).toBe(409);
  });

  it('a failed booking leaves no partial state (seat, appointment, outbox, idempotency)', async () => {
    const h = makeHarness();
    await h.publish('slot:one');
    await h.book('slot:one');
    const before = h.repo.tenant(TENANT_A);
    const snapshot = {
      outbox: before.outbox.length,
      idem: before.idempotency.size,
      history: before.history.length,
    };
    const res = await h.book('slot:one');
    expect(res.status).toBe(409);
    const after = h.repo.tenant(TENANT_A);
    expect(after.outbox.length).toBe(snapshot.outbox);
    expect(after.idempotency.size).toBe(snapshot.idem);
    expect(after.history.length).toBe(snapshot.history);
  });

  it('booking a missing slot is 404 and a started slot is 409', async () => {
    const h = makeHarness();
    expect(detailCode((await h.book('slot:none')).body)).toBe('SLOT_NOT_FOUND');
    await h.publish('slot:a');
    h.clock.set('2026-10-20T04:30:00Z');
    const late = await h.book('slot:a');
    expect(late.status).toBe(409);
    expect(detailCode(late.body)).toBe('SLOT_ALREADY_STARTED');
  });
});

describe('booking lifecycle', () => {
  async function booked(h: Harness, slotRef = 'slot:a'): Promise<string> {
    await h.publish(slotRef, { capacity: 2 });
    citizen(h);
    const res = await h.book(slotRef, { application_id: APPLICATION_ID });
    expect(res.status).toBe(201);
    return (res.body as Body)['appointment_id'] as string;
  }

  it('booking returns the SF-CON-APPOINTMENT record with server-derived identity', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    citizen(h);
    const res = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a', application_id: APPLICATION_ID },
      { key: 'citizen-book-0001' },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenant_id: TENANT_A,
      idempotency_key: 'citizen-book-0001',
      appointment_type_ref: TYPE_REF,
      lifecycle_status: 'BOOKED',
      slot_ref: 'slot:a',
      capacity_atomic: true,
      notification_failure_invalidates_booking: false,
    });
  });

  it('the same Idempotency-Key replays the stored response; a different body conflicts', async () => {
    const h = makeHarness();
    await h.publish('slot:a', { capacity: 5 });
    await h.book('slot:a');
    const first = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a' },
      { key: 'replay-key-01' },
    );
    const replay = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a' },
      { key: 'replay-key-01' },
    );
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(h.repo.tenant(TENANT_A).appointments.size).toBe(2);
    const conflict = await h.call(
      'POST',
      '/v1/appointments',
      { slot_ref: 'slot:a', application_id: APPLICATION_ID },
      { key: 'replay-key-01' },
    );
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict.body)).toBe('SF-APP-002');
  });

  it('reschedule moves the seat atomically and records the previous slot', async () => {
    const h = makeHarness();
    const id = await booked(h);
    await h.publish('slot:b', {
      starts_at: '2026-10-21T04:30:00Z',
      ends_at: '2026-10-21T05:00:00Z',
    });
    citizen(h);
    const res = await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:b' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lifecycle_status: 'RESCHEDULED', slot_ref: 'slot:b' });
    const t = h.repo.tenant(TENANT_A);
    const counts = Object.fromEntries(
      [...t.slots.values()].map((s) => [s.slot_ref, s.booked_count]),
    );
    expect(counts).toEqual({ 'slot:a': 0, 'slot:b': 1 });
    const ev = t.outbox.find((o) => o.envelope.event_type === 'AppointmentRescheduled');
    expect(ev?.envelope.data).toMatchObject({
      previous_slot_ref: 'slot:a',
      slot_ref: 'slot:b',
      version: 2,
    });
  });

  it('reschedule into a full slot fails and leaves the original booking and seats unchanged', async () => {
    const h = makeHarness();
    const id = await booked(h);
    await h.publish('slot:full');
    h.state.ctx = ctxFor(TENANT_A);
    await h.book('slot:full');
    citizen(h);
    const res = await h.call('POST', `/v1/appointments/${id}/reschedule`, {
      slot_ref: 'slot:full',
    });
    expect(res.status).toBe(409);
    expect(detailCode(res.body)).toBe('SLOT_CAPACITY_EXHAUSTED');
    const t = h.repo.tenant(TENANT_A);
    expect(t.appointments.get(id)).toMatchObject({
      lifecycle_status: 'BOOKED',
      slot_ref: 'slot:a',
      version: 1,
    });
    const counts = Object.fromEntries(
      [...t.slots.values()].map((s) => [s.slot_ref, s.booked_count]),
    );
    expect(counts).toEqual({ 'slot:a': 1, 'slot:full': 1 });
  });

  it('reschedule refuses the same slot and a slot of another appointment type', async () => {
    const h = makeHarness();
    const id = await booked(h);
    await h.publish('slot:other', { appointment_type_ref: OTHER_TYPE_REF });
    citizen(h);
    const same = await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:a' });
    expect(detailCode(same.body)).toBe('SAME_SLOT');
    const other = await h.call('POST', `/v1/appointments/${id}/reschedule`, {
      slot_ref: 'slot:other',
    });
    expect(detailCode(other.body)).toBe('APPOINTMENT_TYPE_MISMATCH');
  });

  it('cancel returns the seat; a cancelled appointment cannot be cancelled or rescheduled again', async () => {
    const h = makeHarness();
    const id = await booked(h);
    const res = await h.call('POST', `/v1/appointments/${id}/cancel`, {});
    expect(res.body).toMatchObject({ lifecycle_status: 'CANCELLED' });
    expect([...h.repo.tenant(TENANT_A).slots.values()][0]?.booked_count).toBe(0);
    const again = await h.call('POST', `/v1/appointments/${id}/cancel`, {});
    expect(again.status).toBe(409);
    expect(detailCode(again.body)).toBe('INVALID_APPOINTMENT_TRANSITION');
    await h.publish('slot:b');
    citizen(h);
    const moved = await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:b' });
    expect(detailCode(moved.body)).toBe('INVALID_APPOINTMENT_TRANSITION');
  });

  it('attendance is recorded by officers only after the slot starts; the seat stays consumed', async () => {
    const h = makeHarness();
    const id = await booked(h);
    const byCitizen = await h.call('POST', `/v1/appointments/${id}/attendance`, {
      outcome: 'COMPLETED',
    });
    expect(byCitizen.status).toBe(403);
    h.state.ctx = ctxFor(TENANT_A, ACTOR_OFFICER, 'OFFICER');
    const early = await h.call('POST', `/v1/appointments/${id}/attendance`, {
      outcome: 'COMPLETED',
    });
    expect(detailCode(early.body)).toBe('APPOINTMENT_NOT_STARTED');
    h.clock.set('2026-10-20T04:30:00Z');
    const done = await h.call('POST', `/v1/appointments/${id}/attendance`, { outcome: 'NO_SHOW' });
    expect(done.body).toMatchObject({ lifecycle_status: 'NO_SHOW' });
    expect([...h.repo.tenant(TENANT_A).slots.values()][0]?.booked_count).toBe(1);
    const flip = await h.call('POST', `/v1/appointments/${id}/attendance`, {
      outcome: 'COMPLETED',
    });
    expect(detailCode(flip.body)).toBe('INVALID_APPOINTMENT_TRANSITION');
  });

  it('every transition appends history and emits one domain event plus one audit event', async () => {
    const h = makeHarness();
    const id = await booked(h);
    await h.publish('slot:b', {
      starts_at: '2026-10-21T04:30:00Z',
      ends_at: '2026-10-21T05:00:00Z',
    });
    citizen(h);
    await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:b' });
    await h.call('POST', `/v1/appointments/${id}/cancel`, {});
    const t = h.repo.tenant(TENANT_A);
    expect(t.history.map((x) => `${x.from_status ?? '-'}>${x.to_status}@${x.version}`)).toEqual([
      '->BOOKED@1',
      'BOOKED>RESCHEDULED@2',
      'RESCHEDULED>CANCELLED@3',
    ]);
    const domain = t.outbox.filter((o) => o.topic === 'sf.scheduler.events.v1');
    expect(domain.map((o) => o.envelope.event_type)).toEqual([
      'AppointmentBooked',
      'AppointmentRescheduled',
      'AppointmentCancelled',
    ]);
    const audits = t.outbox
      .filter((o) => o.topic === 'sf.audit.ingest.v1')
      .map((o) => (o.envelope.data as Body)['action']);
    expect(audits).toEqual([
      'APPOINTMENT_SLOT_PUBLISH',
      'APPOINTMENT_BOOK',
      'APPOINTMENT_SLOT_PUBLISH',
      'APPOINTMENT_RESCHEDULE',
      'APPOINTMENT_CANCEL',
    ]);
    expect(JSON.stringify(t.outbox)).not.toMatch(/name|phone|email|address/i);
  });
});

describe('notification failure never invalidates a booking', () => {
  it('a FAILED CMP-025 outcome is recorded append-only and the booking stays BOOKED', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const booked = await h.book('slot:a');
    const id = (booked.body as Body)['appointment_id'] as string;
    h.state.ctx = ctxFor(TENANT_A, undefined, 'INTEGRATION');
    const res = await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
      outcome: 'FAILED',
      outcome_ref: 'notify:0001',
      failure_code: 'SF-SYS-004',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      outcome: 'FAILED',
      booking_invalidated: false,
      appointment_lifecycle_status: 'BOOKED',
    });
    const t = h.repo.tenant(TENANT_A);
    expect(t.appointments.get(id)).toMatchObject({ lifecycle_status: 'BOOKED', version: 1 });
    expect([...t.slots.values()][0]?.booked_count).toBe(1);
    expect(t.outbox.filter((o) => o.topic === 'sf.scheduler.events.v1')).toHaveLength(1);
    h.state.ctx = ctxFor(TENANT_A);
    const read = await h.call('GET', `/v1/appointments/${id}`);
    expect(read.body).toEqual(booked.body);
  });

  it('a repeated outcome_ref is idempotent; a contradicting one conflicts', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const id = ((await h.book('slot:a')).body as Body)['appointment_id'] as string;
    h.state.ctx = ctxFor(TENANT_A, undefined, 'INTEGRATION');
    const body = { outcome: 'FAILED', outcome_ref: 'notify:0002', failure_code: 'SF-SYS-004' };
    expect(
      (await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, body)).status,
    ).toBe(201);
    expect(
      (await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, body)).status,
    ).toBe(200);
    const contra = await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
      outcome: 'SUCCEEDED',
      outcome_ref: 'notify:0002',
    });
    expect(contra.status).toBe(409);
    expect(h.repo.tenant(TENANT_A).outcomes).toHaveLength(1);
  });

  it('citizens and officers cannot record delivery outcomes', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const id = ((await h.book('slot:a')).body as Body)['appointment_id'] as string;
    for (const type of ['CITIZEN', 'OFFICER'] as const) {
      h.state.ctx = ctxFor(TENANT_A, undefined, type);
      const res = await h.call('POST', `/v1/appointments/${id}/notification-outcomes`, {
        outcome: 'SUCCEEDED',
        outcome_ref: 'notify:0003',
      });
      expect(res.status).toBe(403);
    }
  });
});

describe('authorization and transaction boundaries', () => {
  it('OPA deny refuses before any write; PDP outage fails closed with 503', async () => {
    const h = makeHarness();
    await h.publish('slot:a');
    const txBefore = h.repo.txCount;
    h.authorizer.mode = 'deny';
    const denied = await h.book('slot:a');
    expect(denied.status).toBe(403);
    h.authorizer.mode = 'throw';
    const down = await h.book('slot:a');
    expect(down.status).toBe(503);
    expect(detailCode(down.body)).toBe('PDP_UNAVAILABLE');
    expect(h.repo.tenant(TENANT_A).appointments.size).toBe(0);
    expect(h.repo.txCount - txBefore).toBe(2);
  });

  it('the PDP is never called inside a transaction and receives the slot jurisdiction scope', async () => {
    const h = makeHarness();
    await h.publish('slot:a', { capacity: 2 });
    await h.publish('slot:b');
    citizen(h);
    const id = ((await h.book('slot:a', { application_id: APPLICATION_ID })).body as Body)[
      'appointment_id'
    ] as string;
    await h.call('GET', `/v1/appointments/${id}`);
    await h.call('POST', `/v1/appointments/${id}/reschedule`, { slot_ref: 'slot:b' });
    await h.call('POST', `/v1/appointments/${id}/cancel`, {});
    expect(h.authorizer.violations).toBe(0);
    const book = h.authorizer.calls.find((c) => c.action === 'APPOINTMENT_BOOK');
    expect(book?.resource).toMatchObject({
      resource_type: 'Appointment',
      jurisdiction_id: '44444444-4444-4444-8444-444444444444',
      application_id: APPLICATION_ID,
      owner_id: ACTOR_CITIZEN,
    });
    expect(h.authorizer.calls.map((c) => c.action)).toContain('APPOINTMENT_RESCHEDULE');
  });

  it('mutations require an Idempotency-Key; unknown routes and methods are refused', async () => {
    const h = makeHarness();
    expect(
      detailCode((await h.call('POST', '/v1/appointments', { slot_ref: 'x' }, { key: null })).body),
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await h.call('GET', '/v1/nope')).status).toBe(404);
    expect(detailCode((await h.call('DELETE', '/v1/appointments')).body)).toBe(
      'METHOD_NOT_ALLOWED',
    );
    expect(detailCode((await h.call('GET', '/v1/appointments/not-a-uuid')).body)).toBe(
      'UUID_REQUIRED',
    );
  });
});
