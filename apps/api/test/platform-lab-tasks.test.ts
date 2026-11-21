import { describe, expect, it } from 'vitest';
import {
  labHumanTaskPort,
  labPrincipalScopePort,
  readLabAssignmentScope,
} from '../src/platform/tasks.js';

const ORG = '0d15ba00-0a01-4000-8000-0d15ba000a01';
const JUR = '0d15ba00-0b01-4000-8000-0d15ba000b01';

describe('SF-46 SAMPLE_LAB HumanTask bridge', () => {
  it('reads lab_assignment from officers fixture shape', () => {
    expect(
      readLabAssignmentScope({
        lab_assignment: { organisation_id: ORG, jurisdiction_id: JUR },
      }),
    ).toEqual({ organisation_id: ORG, jurisdiction_id: JUR });
  });

  it('refuses non-UUID lab assignment scope', () => {
    expect(() =>
      readLabAssignmentScope({
        lab_assignment: { organisation_id: 'not-a-uuid', jurisdiction_id: JUR },
      }),
    ).toThrow(/lab_assignment/);
  });

  it('widens TENANT_WIDE desk officers to lab org/jurisdiction and leaves others empty', async () => {
    const port = labPrincipalScopePort({ organisation_id: ORG, jurisdiction_id: JUR });
    expect(
      await port.extend({
        tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
        cell_id: 'cell-local',
        actor: { type: 'OFFICER', id: '0d15ba00-0f05-4000-8000-0d15ba000f05' },
        roles: ['SAMPLE_LAB_SCRUTINY_OFFICER'],
        jurisdiction_ids: [],
        auth_assurance: 'MFA',
        correlation_id: '00000000-0000-4000-8000-000000000001',
        trace_id: '0'.repeat(32),
      }),
    ).toEqual({ organisation_ids: [ORG], jurisdiction_ids: [JUR] });
    expect(
      await port.extend({
        tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
        cell_id: 'cell-local',
        actor: { type: 'OFFICER', id: '0d15ba00-0f02-4000-8000-0d15ba000f02' },
        roles: ['STUDIO_DESIGNER'],
        jurisdiction_ids: [],
        auth_assurance: 'MFA',
        correlation_id: '00000000-0000-4000-8000-000000000002',
        trace_id: '0'.repeat(32),
      }),
    ).toEqual({});
  });

  it('create and cancelClose call CMP-017; missing active task on cancel is a no-op', async () => {
    const calls: string[] = [];
    const port = labHumanTaskPort({
      workloadRoles: ['SAMPLE_LAB_WORKFLOW_SEQUENCER'],
      refuse: (code) => new Error(code),
      service: () => ({
        createTask: async () => {
          calls.push('create');
          return { status: 201, body: { task_id: 't1' } };
        },
        findActiveByNode: async () => {
          calls.push('find');
          return null;
        },
        cancelCloseTask: async () => {
          calls.push('cancel');
          return { status: 200, body: {} };
        },
      }),
    });
    const ctx = {
      tenant_id: '0d15ba00-0001-4000-8000-0d15ba0000d1',
      cell_id: 'cell-local',
      actor: { type: 'SYSTEM' as const, id: '0d15ba00-0016-4000-8000-0d15ba0016a0' },
      correlation_id: '00000000-0000-4000-8000-000000000003',
      trace_id: '0'.repeat(32),
    };
    await port.create(ctx, {
      application_id: '00000000-0000-4000-8000-0000000000aa',
      workflow_node_id: 'WAIT_UNDER_SCRUTINY',
      assignment: {
        role_code: 'SAMPLE_LAB_SCRUTINY_OFFICER',
        organisation_id: ORG,
        jurisdiction_id: JUR,
      },
      idempotency_key: 'wf.app.WAIT_UNDER_SCRUTINY.1.create',
    });
    await port.cancelClose(ctx, {
      application_id: '00000000-0000-4000-8000-0000000000aa',
      workflow_node_id: 'WAIT_UNDER_SCRUTINY',
      idempotency_key: 'wf.app.WAIT_UNDER_SCRUTINY.1.close',
    });
    expect(calls).toEqual(['create', 'find']);
  });
});
