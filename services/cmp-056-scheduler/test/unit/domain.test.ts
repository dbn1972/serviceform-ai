import { describe, expect, it } from 'vitest';
import {
  canBook,
  canTransition,
  CAPACITY_ATOMIC,
  INVENTED_STATUTORY_POLICY_FORBIDDEN,
  looksLikeInventedStatutoryCalendar,
  NOTIFICATION_FAILURE_INVALIDATES_BOOKING,
  remainingCapacity,
  toContract,
  type AppointmentRecord,
} from '../../src/domain/appointment.js';
import { TENANT_A } from '../doubles/fixtures.js';

describe('SF-CON-APPOINTMENT constants', () => {
  it('pins capacity_atomic=true and notification_failure_invalidates_booking=false', () => {
    expect(CAPACITY_ATOMIC).toBe(true);
    expect(NOTIFICATION_FAILURE_INVALIDATES_BOOKING).toBe(false);
    expect(INVENTED_STATUTORY_POLICY_FORBIDDEN).toBe(true);
  });

  it('projects the frozen contract shape', () => {
    const row: AppointmentRecord = {
      tenant_id: TENANT_A,
      appointment_id: '22222222-2222-4222-8222-222222222222',
      appointment_type_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      appointment_type_ref: 'meta:appointment-type:hearing-slot',
      slot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slot_ref: 'slot:calendar-1:2026-10-20T10:00',
      resource_calendar_ref: null,
      lifecycle_status: 'BOOKED',
      appointment_version: 1,
      participant_ref: null,
      notification_status: 'PENDING',
      created_at: '2026-10-10T10:00:00.000Z',
      updated_at: '2026-10-10T10:00:00.000Z',
      created_by: '33333333-3333-4333-8333-333333333333',
      last_correlation_id: '77777777-7777-4777-8777-777777777777',
    };
    const c = toContract(row, 'idem-appointment-0001', row.last_correlation_id);
    expect(c['contract_id']).toBe('SF-CON-APPOINTMENT');
    expect(c['contract_status']).toBe('FROZEN');
    expect(c['capacity_atomic']).toBe(true);
    expect(c['notification_failure_invalidates_booking']).toBe(false);
    expect(c['invented_statutory_policy_forbidden']).toBe(true);
  });
});

describe('atomic capacity', () => {
  it('refuses booking when remaining capacity is zero', () => {
    expect(canBook({ capacity: 1, booked_count: 1 })).toBe(false);
    expect(remainingCapacity({ capacity: 2, booked_count: 1 })).toBe(1);
    expect(canBook({ capacity: 1, booked_count: 0 })).toBe(true);
  });
});

describe('lifecycle transitions', () => {
  it('allows cancel/complete/no-show/reschedule from active states only', () => {
    expect(canTransition('BOOKED', 'CANCELLED').allowed).toBe(true);
    expect(canTransition('RESCHEDULED', 'COMPLETED').allowed).toBe(true);
    expect(canTransition('BOOKED', 'NO_SHOW').allowed).toBe(true);
    expect(canTransition('BOOKED', 'RESCHEDULED').allowed).toBe(true);
    expect(canTransition('CANCELLED', 'BOOKED').allowed).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED').reason).toBe('TERMINAL_STATE');
  });
});

describe('invented statutory calendar guard', () => {
  it('allows opaque metadata refs and refuses statute-looking calendars', () => {
    expect(looksLikeInventedStatutoryCalendar('meta:appointment-type:hearing-slot')).toBe(false);
    expect(looksLikeInventedStatutoryCalendar('Code of Civil Procedure Sch.I')).toBe(true);
    expect(looksLikeInventedStatutoryCalendar('statutory hearing calendar 2026')).toBe(true);
  });
});
