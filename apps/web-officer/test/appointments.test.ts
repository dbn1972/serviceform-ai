import { describe, expect, it } from 'vitest';
import {
  toAppointmentCard,
  toSlotCard,
  type PlatformAppointmentView,
  type PlatformSlot,
} from '../lib/portal/appointments';
import { deskHomeForRoles, isInspectionRole } from '../lib/portal/desk';

const slot: PlatformSlot = {
  slot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slot_ref: 'slot:sample-lab:site-visit:morning-1',
  appointment_type_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  capacity: 1,
  booked_count: 0,
  remaining: 1,
  capacity_atomic: true,
  opens_at: '2026-11-22T04:00:00.000Z',
  closes_at: '2026-11-22T06:00:00.000Z',
};

const booked: PlatformAppointmentView = {
  appointment: {
    appointment_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    appointment_type_ref: 'meta:appointment-type:site-visit',
    lifecycle_status: 'BOOKED',
    slot_ref: 'slot:sample-lab:site-visit:morning-1',
    capacity_atomic: true,
    notification_failure_invalidates_booking: false,
    invented_statutory_policy_forbidden: true,
  },
  appointment_version: 1,
  notification_status: 'SENT',
  participant_ref: 'participant:sample-lab:case-1',
  created_at: '2026-11-21T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
};

describe('officer scheduling desk helpers', () => {
  it('projects open slots with book action and catalogue label', () => {
    const typeRefById = new Map([[slot.appointment_type_id, 'meta:appointment-type:site-visit']]);
    const card = toSlotCard(slot, typeRefById);
    expect(card.can_book).toBe(true);
    expect(card.label).toBe('Site visit · morning');
    expect(card.type_label).toBe('Site visit appointment');
    expect(toSlotCard({ ...slot, remaining: 0 }, typeRefById).can_book).toBe(false);
  });

  it('enables lifecycle actions only while booked/rescheduled', () => {
    const card = toAppointmentCard(booked);
    expect(card.can_reschedule).toBe(true);
    expect(card.can_cancel).toBe(true);
    expect(card.can_complete).toBe(true);
    expect(card.related_inspection_pin).toBe('TRADE_LICENCE_SITE_VISIT');
    const done = toAppointmentCard({
      ...booked,
      appointment: { ...booked.appointment, lifecycle_status: 'COMPLETED' },
    });
    expect(done.can_cancel).toBe(false);
    expect(done.state_label).toBe('Completed');
  });

  it('keeps inspection desk routing for inspection-only officers', () => {
    expect(isInspectionRole('SAMPLE_LAB_INSPECTION_OFFICER')).toBe(true);
    expect(deskHomeForRoles(['SAMPLE_LAB_INSPECTION_OFFICER'])).toBe('/inspection');
  });
});
