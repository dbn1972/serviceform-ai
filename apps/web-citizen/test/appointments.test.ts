import { describe, expect, it } from 'vitest';
import {
  applicationIdFromParticipant,
  applicationParticipantRef,
  citizenParticipantRef,
  toAppointmentCard,
  toSlotCard,
  type PlatformAppointmentView,
  type PlatformSlot,
} from '../lib/portal/appointments';

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
  participant_ref: 'participant:application:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  created_at: '2026-11-21T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
};

describe('citizen appointment booking helpers', () => {
  it('projects open slots with book action and catalogue label', () => {
    const typeRefById = new Map([[slot.appointment_type_id, 'meta:appointment-type:site-visit']]);
    const card = toSlotCard(slot, typeRefById);
    expect(card.can_book).toBe(true);
    expect(card.label).toBe('Site visit · morning');
    expect(card.type_label).toBe('Site visit appointment');
  });

  it('enables citizen reschedule/cancel only while booked and exposes wait bindings', () => {
    const card = toAppointmentCard(booked);
    expect(card.can_reschedule).toBe(true);
    expect(card.can_cancel).toBe(true);
    expect(card.application_id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(card.wait_bindings.some((b) => b.workflow_wait_node_id === 'WAIT_VERIFICATION')).toBe(
      true,
    );
    const done = toAppointmentCard({
      ...booked,
      appointment: { ...booked.appointment, lifecycle_status: 'COMPLETED' },
    });
    expect(done.can_cancel).toBe(false);
  });

  it('builds opaque participant refs without PII', () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const aid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(citizenParticipantRef(cid)).toBe(`participant:citizen:${cid}`);
    expect(applicationParticipantRef(aid)).toBe(`participant:application:${aid}`);
    expect(applicationIdFromParticipant(applicationParticipantRef(aid))).toBe(aid);
    expect(applicationIdFromParticipant(citizenParticipantRef(cid))).toBeNull();
  });
});
