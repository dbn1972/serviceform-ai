import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LAB_APPOINTMENT_TYPES,
  SAMPLE_LAB_APPOINTMENT_WAIT_BINDINGS,
  SAMPLE_LAB_SLOT_TEMPLATES,
  appointmentTypeByRef,
  applicationParticipantRef,
  citizenParticipantRef,
  lifecycleLabel,
  parseApplicationParticipantRef,
  slotTemplateByRef,
  waitBindingsForEvent,
} from '../src/appointment-catalogue.js';

describe('SAMPLE_LAB appointment catalogue', () => {
  it('exposes opaque metadata refs only (no statute calendar free text)', () => {
    for (const t of SAMPLE_LAB_APPOINTMENT_TYPES) {
      expect(t.appointment_type_ref.startsWith('meta:')).toBe(true);
      expect(t.description.toLowerCase()).not.toContain('code of civil procedure');
      expect(t.description.toLowerCase()).not.toContain('statutory hearing calendar');
    }
    for (const s of SAMPLE_LAB_SLOT_TEMPLATES) {
      expect(s.slot_ref.startsWith('slot:')).toBe(true);
      expect(s.capacity).toBeGreaterThanOrEqual(1);
      expect(appointmentTypeByRef(s.appointment_type_ref)).not.toBeNull();
    }
  });

  it('links site-visit type to inspection pin metadata without forking on officer names', () => {
    const site = appointmentTypeByRef('meta:appointment-type:site-visit');
    expect(site?.related_inspection_pin).toBe('TRADE_LICENCE_SITE_VISIT');
    expect(site?.catalogue_id).toBe('IND-BTP-001');
    expect(slotTemplateByRef('slot:sample-lab:site-visit:morning-1')?.capacity).toBe(1);
  });

  it('labels lifecycle statuses for desk UI', () => {
    expect(lifecycleLabel('BOOKED')).toBe('Booked');
    expect(lifecycleLabel('NO_SHOW')).toBe('No-show');
    expect(lifecycleLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('maps opaque participant refs for citizen / application wait correlation', () => {
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const aid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(citizenParticipantRef(cid)).toBe(`participant:citizen:${cid}`);
    expect(applicationParticipantRef(aid)).toBe(`participant:application:${aid}`);
    expect(parseApplicationParticipantRef(applicationParticipantRef(aid))).toBe(aid);
    expect(parseApplicationParticipantRef(citizenParticipantRef(cid))).toBeNull();
  });

  it('publishes wait bindings that release WAIT_VERIFICATION on COMPLETED', () => {
    expect(SAMPLE_LAB_APPOINTMENT_WAIT_BINDINGS.length).toBeGreaterThan(0);
    const hits = waitBindingsForEvent('meta:appointment-type:site-visit', 'COMPLETED');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.workflow_wait_node_id).toBe('WAIT_VERIFICATION');
    expect(hits[0]?.case_command).toBe('ENTER_DECISION_PENDING');
    expect(waitBindingsForEvent('meta:appointment-type:site-visit', 'BOOKED')).toHaveLength(0);
  });
});
