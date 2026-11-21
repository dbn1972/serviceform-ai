import { describe, expect, it } from 'vitest';
import { parseAppointmentCatalogue } from '../src/platform/scheduler.js';

describe('SAMPLE_LAB appointment catalogue (CMP-056)', () => {
  it('parses opaque types and refuses empty refs', () => {
    const catalogue = parseAppointmentCatalogue({
      workload: {
        actor_id: '05605605-0000-4000-8000-056056056056',
        roles: ['SAMPLE_LAB_SCHEDULER_ADMIN'],
      },
      appointment_types: [
        {
          appointment_type_ref: 'meta:appointment-type:site-visit',
          resource_calendar_ref: 'meta:calendar:sample-lab-working-week',
          label: 'Site visit',
          description: 'lab',
          related_inspection_pin: 'TRADE_LICENCE_SITE_VISIT',
          catalogue_id: 'IND-LIC-001',
        },
        {
          appointment_type_ref: '',
          label: 'skipped',
        },
      ],
      slot_templates: [
        {
          appointment_type_ref: 'meta:appointment-type:site-visit',
          slot_ref: 'slot:sample-lab:site-visit:morning-1',
          capacity: 1,
          opens_offset_hours: 24,
          duration_hours: 2,
          label: 'Morning',
        },
        {
          appointment_type_ref: 'meta:appointment-type:site-visit',
          slot_ref: 'slot:bad',
          capacity: 0,
          label: 'invalid capacity skipped',
        },
      ],
    });

    expect(catalogue.appointment_types).toHaveLength(1);
    expect(catalogue.appointment_types[0]?.related_inspection_pin).toBe('TRADE_LICENCE_SITE_VISIT');
    expect(catalogue.slot_templates).toHaveLength(1);
    expect(catalogue.workload.roles).toContain('SAMPLE_LAB_SCHEDULER_ADMIN');
  });

  it('falls back to defaults when raw is empty', () => {
    const catalogue = parseAppointmentCatalogue({});
    expect(catalogue.appointment_types.length).toBeGreaterThan(0);
    expect(catalogue.slot_templates.length).toBeGreaterThan(0);
    expect(catalogue.appointment_types[0]?.appointment_type_ref.startsWith('meta:')).toBe(true);
  });
});
