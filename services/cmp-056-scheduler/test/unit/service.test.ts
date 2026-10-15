import { describe, expect, it } from 'vitest';
import { TOPIC_DOMAIN } from '../../src/outbox.js';
import {
  ACTOR_CITIZEN,
  ctxFor,
  SLOT_REF_1,
  SLOT_REF_2,
  TENANT_A,
  TENANT_B,
  TYPE_REF,
} from '../doubles/fixtures.js';
import { makeHarness, type Harness } from '../doubles/harness.js';
import type { MemorySchedulerRepository } from '../doubles/memory-repo.js';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const mem = (h: Harness): MemorySchedulerRepository => h.repo as MemorySchedulerRepository;

async function seedTypeAndSlot(
  h: Harness,
  capacity = 1,
  slotRef = SLOT_REF_1,
): Promise<{ typeId: string; slotRef: string }> {
  const type = await h.call('POST', '/v1/appointments/types', {
    appointment_type_ref: TYPE_REF,
    resource_calendar_ref: null,
  });
  expect(type.status, JSON.stringify(type.body)).toBe(201);
  const typeId = (type.body as Body)['appointment_type_id'] as string;
  const slot = await h.call('POST', '/v1/appointments/slots', {
    appointment_type_id: typeId,
    slot_ref: slotRef,
    capacity,
    opens_at: '2026-10-20T10:00:00.000Z',
    closes_at: '2026-10-20T10:30:00.000Z',
  });
  expect(slot.status, JSON.stringify(slot.body)).toBe(201);
  return { typeId, slotRef };
}

describe('book / atomic capacity (INT-014)', () => {
  it('books a single-capacity slot and refuses a second concurrent booker', async () => {
    const h = makeHarness();
    await seedTypeAndSlot(h, 1);
    const first = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(first.status).toBe(201);
    const appt = (first.body as Body)['appointment'];
    expect(appt['capacity_atomic']).toBe(true);
    expect(appt['notification_failure_invalidates_booking']).toBe(false);
    expect(appt['lifecycle_status']).toBe('BOOKED');
    expect(appt['contract_id']).toBe('SF-CON-APPOINTMENT');

    const second = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(second.status).toBe(409);
    expect((second.body as Body)['details'][0]['code']).toBe('SLOT_FULL');
  });

  it('keeps the booking when notification fails (notify ≠ invalidate)', async () => {
    const h = makeHarness();
    await seedTypeAndSlot(h, 1);
    h.notifier.fail = true;
    const res = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(res.status).toBe(201);
    const body = res.body as Body;
    expect(body['appointment']['lifecycle_status']).toBe('BOOKED');
    expect(body['notification_status']).toBe('FAILED');
    const id = body['appointment']['appointment_id'] as string;
    const got = await h.call('GET', `/v1/appointments/${id}`);
    expect(got.status).toBe(200);
    expect((got.body as Body)['appointment']['lifecycle_status']).toBe('BOOKED');
    expect((got.body as Body)['notification_status']).toBe('FAILED');
  });

  it('emits AppointmentBooked on the domain topic', async () => {
    const h = makeHarness();
    await seedTypeAndSlot(h, 1);
    await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    const events = mem(h)
      .tenant(TENANT_A)
      .outbox.filter((o) => o.topic === TOPIC_DOMAIN)
      .map((o) => o.envelope.event_type);
    expect(events).toContain('AppointmentBooked');
  });
});

describe('reschedule / cancel', () => {
  it('reschedules onto another slot and releases capacity on the old slot', async () => {
    const h = makeHarness();
    const { typeId } = await seedTypeAndSlot(h, 1, SLOT_REF_1);
    await h.call('POST', '/v1/appointments/slots', {
      appointment_type_id: typeId,
      slot_ref: SLOT_REF_2,
      capacity: 1,
      opens_at: '2026-10-20T11:00:00.000Z',
      closes_at: '2026-10-20T11:30:00.000Z',
    });
    const booked = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    const id = (booked.body as Body)['appointment']['appointment_id'] as string;
    const ver = (booked.body as Body)['appointment_version'] as number;
    const res = await h.call('POST', `/v1/appointments/${id}/reschedule`, {
      slot_ref: SLOT_REF_2,
      expected_version: ver,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as Body)['appointment']['lifecycle_status']).toBe('RESCHEDULED');
    expect((res.body as Body)['appointment']['slot_ref']).toBe(SLOT_REF_2);

    // Old slot capacity freed — a new booking can take SLOT_REF_1
    const again = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(again.status).toBe(201);
  });

  it('cancels and frees capacity', async () => {
    const h = makeHarness();
    await seedTypeAndSlot(h, 1);
    const booked = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    const id = (booked.body as Body)['appointment']['appointment_id'] as string;
    const ver = (booked.body as Body)['appointment_version'] as number;
    const cancel = await h.call('POST', `/v1/appointments/${id}/cancel`, {
      expected_version: ver,
    });
    expect(cancel.status).toBe(200);
    expect((cancel.body as Body)['appointment']['lifecycle_status']).toBe('CANCELLED');
    const again = await h.call('POST', '/v1/appointments', { slot_ref: SLOT_REF_1 });
    expect(again.status).toBe(201);
  });
});

describe('tenant / OPA / statutory invention', () => {
  it('refuses client-supplied tenant_id and invented statutory calendars', async () => {
    const h = makeHarness();
    const t = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: TYPE_REF,
      tenant_id: TENANT_B,
    });
    expect(t.status).toBe(403);
    const bad = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: 'Code of Civil Procedure Sch.I',
    });
    expect(bad.status).toBe(400);
    expect((bad.body as Body)['details'][0]['code']).toBe('INVENTED_STATUTORY_CALENDAR_FORBIDDEN');
  });

  it('denies when OPA refuses and refuses citizen type registration', async () => {
    const h = makeHarness();
    h.authorizer.deniedActions.add('APPOINTMENT_TYPE_REGISTER');
    const denied = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: TYPE_REF,
    });
    expect(denied.status).toBe(403);
    h.authorizer.deniedActions.clear();
    h.state.ctx = ctxFor(TENANT_A, ACTOR_CITIZEN, 'CITIZEN');
    const citizen = await h.call('POST', '/v1/appointments/types', {
      appointment_type_ref: TYPE_REF,
    });
    expect(citizen.status).toBe(403);
  });

  it('lists remaining capacity on available slots', async () => {
    const h = makeHarness();
    await seedTypeAndSlot(h, 2);
    const list = await h.call('GET', '/v1/appointments/slots');
    expect(list.status).toBe(200);
    const slots = (list.body as Body)['slots'] as Body[];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.['remaining']).toBe(2);
    expect((list.body as Body)['capacity_atomic']).toBe(true);
  });
});
