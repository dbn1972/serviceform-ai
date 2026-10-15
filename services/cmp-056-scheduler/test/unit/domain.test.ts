import { describe, expect, it } from 'vitest';
import {
  appointmentView,
  assertTransition,
  canTransition,
  isTerminal,
  LIFECYCLE_STATUSES,
  SEAT_HOLDING,
  type AppointmentRow,
  type LifecycleStatus,
} from '../../src/domain/appointment.js';
import { slotView, unavailableReason, type SlotRow } from '../../src/domain/slot.js';
import { mapPgError } from '../../src/errors.js';
import {
  parseInstant,
  validateBookInput,
  validateNotificationInput,
  validateSlotInput,
  validateSlotQuery,
} from '../../src/service/input.js';
import { slotInput, TENANT_A } from '../doubles/fixtures.js';

const slot = (o: Partial<SlotRow> = {}): SlotRow => ({
  tenant_id: TENANT_A,
  slot_id: '22222222-2222-4222-8222-222222222222',
  slot_ref: 'slot:a',
  appointment_type_ref: 'meta:t',
  resource_calendar_ref: null,
  jurisdiction_id: null,
  starts_at: '2026-10-20T04:30:00.000Z',
  ends_at: '2026-10-20T05:00:00.000Z',
  capacity: 2,
  booked_count: 1,
  status: 'OPEN',
  actor_type: 'SYSTEM',
  created_by: '77777777-7777-4777-8777-777777777777',
  correlation_id: '33333333-3333-4333-8333-333333333333',
  created_at: '2026-10-14T04:00:00.000Z',
  updated_at: '2026-10-14T04:00:00.000Z',
  ...o,
});

describe('appointment lifecycle', () => {
  const allowed: [LifecycleStatus, LifecycleStatus][] = [
    ['BOOKED', 'RESCHEDULED'],
    ['BOOKED', 'CANCELLED'],
    ['BOOKED', 'COMPLETED'],
    ['BOOKED', 'NO_SHOW'],
    ['RESCHEDULED', 'RESCHEDULED'],
    ['RESCHEDULED', 'CANCELLED'],
    ['RESCHEDULED', 'COMPLETED'],
    ['RESCHEDULED', 'NO_SHOW'],
  ];

  it('permits exactly the declared transitions', () => {
    for (const from of LIFECYCLE_STATUSES) {
      for (const to of LIFECYCLE_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from}->${to}`).toBe(expected);
      }
    }
  });

  it('CANCELLED, COMPLETED and NO_SHOW are terminal; nothing returns to BOOKED', () => {
    expect(LIFECYCLE_STATUSES.filter(isTerminal)).toEqual(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
    for (const from of LIFECYCLE_STATUSES) expect(canTransition(from, 'BOOKED')).toBe(false);
    expect(() => assertTransition('CANCELLED', 'RESCHEDULED')).toThrow(
      expect.objectContaining({ code: 'SF-APP-001' }),
    );
  });

  it('only CANCELLED releases a seat', () => {
    expect(LIFECYCLE_STATUSES.filter((s) => !SEAT_HOLDING.has(s))).toEqual(['CANCELLED']);
  });

  it('the view carries the frozen SF-CON-APPOINTMENT constants and nothing internal', () => {
    const row: AppointmentRow = {
      tenant_id: TENANT_A,
      appointment_id: '22222222-2222-4222-8222-222222222223',
      appointment_type_ref: 'meta:t',
      slot_id: '22222222-2222-4222-8222-222222222222',
      slot_ref: 'slot:a',
      resource_calendar_ref: null,
      application_id: '33333333-3333-4333-8333-333333333333',
      lifecycle_status: 'BOOKED',
      idempotency_key: 'book-key-0001',
      version: 1,
      correlation_id: '33333333-3333-4333-8333-333333333334',
      actor_type: 'CITIZEN',
      booked_by: '77777777-7777-4777-8777-777777777778',
      booked_at: '2026-10-14T04:00:00.000Z',
      updated_at: '2026-10-14T04:00:00.000Z',
    };
    const view = appointmentView(row);
    expect(view).toMatchObject({
      contract_id: 'SF-CON-APPOINTMENT',
      contract_status: 'FROZEN',
      freeze_status: 'FROZEN',
      capacity_atomic: true,
      notification_failure_invalidates_booking: false,
      invented_statutory_policy_forbidden: true,
    });
    for (const k of ['slot_id', 'booked_by', 'application_id', 'version', 'actor_type']) {
      expect(view).not.toHaveProperty(k);
    }
  });
});

describe('slot rules', () => {
  const now = new Date('2026-10-14T04:00:00Z');

  it('explains an unavailable slot from its state', () => {
    expect(unavailableReason(slot({ status: 'CLOSED' }), now)).toBe('SLOT_CLOSED');
    expect(unavailableReason(slot({ starts_at: '2026-10-14T03:00:00.000Z' }), now)).toBe(
      'SLOT_ALREADY_STARTED',
    );
    expect(unavailableReason(slot({ booked_count: 2 }), now)).toBe('SLOT_CAPACITY_EXHAUSTED');
  });

  it('reports remaining capacity and is always capacity_atomic', () => {
    expect(slotView(slot())).toMatchObject({ remaining_capacity: 1, capacity_atomic: true });
    expect(slotView(slot({ booked_count: 2 })).remaining_capacity).toBe(0);
  });
});

describe('input validation', () => {
  it('normalises explicit-offset instants to UTC and refuses offset-less or garbage values', () => {
    expect(parseInstant('2026-10-20T10:00:00+05:30', '/x')).toBe('2026-10-20T04:30:00.000Z');
    expect(parseInstant('2026-10-20T04:30Z', '/x')).toBe('2026-10-20T04:30:00.000Z');
    expect(parseInstant('2026-10-20T04:30:00.123456Z', '/x')).toBe('2026-10-20T04:30:00.123Z');
    for (const bad of [
      '2026-10-20T10:00:00',
      '2026-10-20',
      'tomorrow',
      42,
      `${'9'.repeat(50)}`,
      '2026-10-20T04:30:00.Z',
      '2026-10-20T04:30:00.1234567Z',
      '2026-10-20T04:30:00+0530',
      '2026-10-20T04:30:00Zjunk',
      '2026-10-20 04:30:00Z',
    ]) {
      expect(() => parseInstant(bad, '/x')).toThrow(
        expect.objectContaining({ code: 'SF-SYS-003' }),
      );
    }
  });

  it('a slot needs a positive window and a bounded integer capacity', () => {
    expect(validateSlotInput(slotInput('slot:a')).capacity).toBe(1);
    for (const o of [
      { ends_at: '2026-10-20T04:30:00Z' },
      { capacity: 0 },
      { capacity: 1.5 },
      { capacity: 10_001 },
      { slot_ref: 'has space' },
      { jurisdiction_id: 'not-a-uuid' },
    ]) {
      expect(() => validateSlotInput(slotInput('slot:a', o)), JSON.stringify(o)).toThrow(
        expect.objectContaining({ code: 'SF-SYS-003' }),
      );
    }
  });

  it.each([
    ['tenant_id'],
    ['appointment_id'],
    ['lifecycle_status'],
    ['capacity_atomic'],
    ['notification_failure_invalidates_booking'],
    ['booked_count'],
    ['overbook'],
  ])('client authority key %s is refused on booking', (key) => {
    expect(() => validateBookInput({ slot_ref: 'slot:a', [key]: true })).toThrow(
      expect.objectContaining({
        code: 'SF-SYS-003',
        details: [{ code: 'CLIENT_AUTHORITY_FORBIDDEN', pointer: `/${key}` }],
      }),
    );
  });

  it('client time is never authoritative', () => {
    expect(() => validateBookInput({ slot_ref: 'slot:a', now: '2020-01-01T00:00:00Z' })).toThrow(
      expect.objectContaining({
        details: [expect.objectContaining({ code: 'CLIENT_TIME_NOT_AUTHORITATIVE' })],
      }),
    );
  });

  it('a FAILED notification needs a catalogue failure code; SUCCEEDED must not carry one', () => {
    expect(
      validateNotificationInput({
        outcome: 'FAILED',
        outcome_ref: 'n:1',
        failure_code: 'SF-SYS-004',
      }),
    ).toMatchObject({ failure_code: 'SF-SYS-004' });
    expect(() => validateNotificationInput({ outcome: 'FAILED', outcome_ref: 'n:1' })).toThrow();
    expect(() =>
      validateNotificationInput({
        outcome: 'SUCCEEDED',
        outcome_ref: 'n:1',
        failure_code: 'SF-SYS-004',
      }),
    ).toThrow();
  });

  it('slot queries accept known filters only and a sane range', () => {
    expect(validateSlotQuery({}).limit).toBe(50);
    expect(() => validateSlotQuery({ holiday_calendar: 'x' })).toThrow();
    expect(() => validateSlotQuery({ limit: '0' })).toThrow();
    expect(() => validateSlotQuery({ limit: '201' })).toThrow();
    expect(() =>
      validateSlotQuery({ from: '2026-10-20T00:00:00Z', to: '2026-10-19T00:00:00Z' }),
    ).toThrow();
  });
});

describe('PostgreSQL error mapping', () => {
  it.each([
    ['42501', 'SF-TEN-002'],
    ['55000', 'SF-APP-001'],
    ['23505', 'SF-APP-002'],
    ['23503', 'SF-SYS-002'],
    ['23514', 'SF-SYS-003'],
    ['XX000', 'SF-SYS-001'],
  ])('%s maps to %s', (pg, code) => {
    expect(mapPgError(Object.assign(new Error(pg), { code: pg })).code).toBe(code);
  });
});
