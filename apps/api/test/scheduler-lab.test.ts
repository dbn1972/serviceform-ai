import { describe, expect, it, vi } from 'vitest';
import {
  LabAppointmentWorkflowSignalPort,
  parseAppointmentCatalogue,
  parseApplicationParticipantRef,
} from '../src/platform/scheduler.js';

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
          catalogue_id: 'IND-BTP-001',
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
      wait_bindings: [
        {
          binding_id: 'wait:sample-lab:verification-on-site-visit-complete',
          appointment_type_ref: 'meta:appointment-type:site-visit',
          on_lifecycle_status: 'COMPLETED',
          case_expected_state: 'VERIFICATION',
          case_command: 'ENTER_DECISION_PENDING',
          workflow_wait_node_id: 'WAIT_VERIFICATION',
          label: 'Release verification wait',
        },
        {
          binding_id: 'skip-bad',
          appointment_type_ref: 'meta:appointment-type:site-visit',
          on_lifecycle_status: 'NOT_A_STATUS',
          case_expected_state: 'VERIFICATION',
          case_command: 'ENTER_DECISION_PENDING',
          workflow_wait_node_id: 'WAIT_VERIFICATION',
        },
      ],
    });

    expect(catalogue.appointment_types).toHaveLength(1);
    expect(catalogue.appointment_types[0]?.related_inspection_pin).toBe('TRADE_LICENCE_SITE_VISIT');
    expect(catalogue.slot_templates).toHaveLength(1);
    expect(catalogue.workload.roles).toContain('SAMPLE_LAB_SCHEDULER_ADMIN');
    expect(catalogue.wait_bindings).toHaveLength(1);
    expect(catalogue.wait_bindings[0]?.workflow_wait_node_id).toBe('WAIT_VERIFICATION');
  });

  it('falls back to defaults when raw is empty', () => {
    const catalogue = parseAppointmentCatalogue({});
    expect(catalogue.appointment_types.length).toBeGreaterThan(0);
    expect(catalogue.slot_templates.length).toBeGreaterThan(0);
    expect(catalogue.appointment_types[0]?.appointment_type_ref.startsWith('meta:')).toBe(true);
    expect(catalogue.wait_bindings).toEqual([]);
  });
});

describe('SAMPLE_LAB appointment wait-on-appointment signal', () => {
  it('parses application participant refs only', () => {
    const aid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(parseApplicationParticipantRef(`participant:application:${aid}`)).toBe(aid);
    expect(parseApplicationParticipantRef('participant:citizen:x')).toBeNull();
  });

  it('releases WAIT_VERIFICATION via ENTER_DECISION_PENDING when COMPLETED matches', async () => {
    const commandBodies: unknown[] = [];
    const executeCommand = vi.fn(
      async (_ctx: unknown, _id: unknown, body: unknown, _key: unknown) => {
        commandBodies.push(body);
        return { status: 200, body: {} };
      },
    );
    const getApplication = vi.fn(async () => ({
      status: 200,
      body: {
        application: {
          application_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          state: 'VERIFICATION',
          aggregate_version: 3,
        },
      },
    }));
    const catalogue = parseAppointmentCatalogue({
      wait_bindings: [
        {
          binding_id: 'wait:sample-lab:verification-on-site-visit-complete',
          appointment_type_ref: 'meta:appointment-type:site-visit',
          on_lifecycle_status: 'COMPLETED',
          case_expected_state: 'VERIFICATION',
          case_command: 'ENTER_DECISION_PENDING',
          workflow_wait_node_id: 'WAIT_VERIFICATION',
          label: 'Release',
        },
      ],
    });
    const port = new LabAppointmentWorkflowSignalPort(
      { getApplication, listTransitions: vi.fn(), executeCommand },
      catalogue,
      () =>
        ({
          tenant_id: '11111111-1111-4111-8111-111111111111',
          cell_id: '22222222-2222-4222-8222-222222222222',
          actor: { type: 'SYSTEM', id: '05605605-0000-4000-8000-056056056056' },
          roles: ['SAMPLE_LAB_SCHEDULER_ADMIN'],
          jurisdiction_ids: [],
          auth_assurance: 'WORKLOAD_IDENTITY',
          correlation_id: '33333333-3333-4333-8333-333333333333',
          trace_id: 'trace',
        }) as never,
    );

    await port.onAppointmentLifecycle({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      appointment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      appointment_type_ref: 'meta:appointment-type:site-visit',
      slot_ref: 'slot:sample-lab:site-visit:morning-1',
      lifecycle_status: 'COMPLETED',
      correlation_id: '33333333-3333-4333-8333-333333333333',
      participant_ref: 'participant:application:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });

    expect(executeCommand).toHaveBeenCalledOnce();
    expect(commandBodies[0]).toMatchObject({
      command: 'ENTER_DECISION_PENDING',
      expected_state: 'VERIFICATION',
    });
    expect(port.signals).toHaveLength(1);
  });

  it('does not signal when case state does not match wait binding', async () => {
    const executeCommand = vi.fn();
    const catalogue = parseAppointmentCatalogue({
      wait_bindings: [
        {
          binding_id: 'wait:x',
          appointment_type_ref: 'meta:appointment-type:site-visit',
          on_lifecycle_status: 'COMPLETED',
          case_expected_state: 'VERIFICATION',
          case_command: 'ENTER_DECISION_PENDING',
          workflow_wait_node_id: 'WAIT_VERIFICATION',
          label: 'Release',
        },
      ],
    });
    const port = new LabAppointmentWorkflowSignalPort(
      {
        getApplication: vi.fn(async () => ({
          status: 200,
          body: { application: { state: 'UNDER_SCRUTINY', aggregate_version: 1 } },
        })),
        listTransitions: vi.fn(),
        executeCommand,
      },
      catalogue,
      () =>
        ({
          tenant_id: '11111111-1111-4111-8111-111111111111',
          cell_id: '22222222-2222-4222-8222-222222222222',
          actor: { type: 'SYSTEM', id: '05605605-0000-4000-8000-056056056056' },
          roles: ['SAMPLE_LAB_SCHEDULER_ADMIN'],
          jurisdiction_ids: [],
          auth_assurance: 'WORKLOAD_IDENTITY',
          correlation_id: '33333333-3333-4333-8333-333333333333',
          trace_id: 'trace',
        }) as never,
    );
    await port.onAppointmentLifecycle({
      tenant_id: '11111111-1111-4111-8111-111111111111',
      appointment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      appointment_type_ref: 'meta:appointment-type:site-visit',
      slot_ref: 'slot:x',
      lifecycle_status: 'COMPLETED',
      correlation_id: '33333333-3333-4333-8333-333333333333',
      participant_ref: 'participant:application:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
