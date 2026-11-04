import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  call,
  citizenLogin,
  closeAdmin,
  command,
  createDraft,
  FIXTURE_A,
  HOST_A,
  LAB_ENV_FILE,
  officerLogin,
  putWorkingData,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  must,
  TSB_A,
} from './support/platform.js';

/**
 * INT-005 (Application → Temporal → officer task → OPA-authorized action) posture on Phase B.
 * EXPECTED GAP, not a failure: CMP-016/Temporal is not composed on this path (evidence/SF-M10-B-2
 * "Not wired"). These tests pin the current posture so that wiring CMP-016 visibly changes them.
 * The OPA-authorized officer action half of INT-005 IS on the path and is asserted.
 */
describe('INT-005 posture: no Temporal sequencing on the Phase B path', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  let app: App;
  const advances: unknown[] = [];
  const temporalAdvanced: unknown[] = [];

  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
    app = (await createDraft(HOST_A(), citizen.token, TSB_A())).body['application'] as App;
    await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    for (const [cmd, token] of [
      ['MARK_READY_TO_SUBMIT', citizen.token],
      ['SUBMIT', citizen.token],
      ['MARK_RECEIVED', officer.token],
    ] as const) {
      const r = await command(HOST_A(), token, app, cmd);
      expect(r.status).toBe(200);
      advances.push(r.body['workflow_advance']);
      temporalAdvanced.push(
        (r.body['command_transition'] as { temporal_advanced?: unknown } | undefined)
          ?.temporal_advanced,
      );
      app = r.body['application'] as App;
    }
  });
  afterAll(closeAdmin);

  it('observed: the no-op OutboxOnlyWorkflowAdvance reports SIGNALLED / temporal_advanced=true', () => {
    expect(advances).toEqual(['SIGNALLED', 'SIGNALLED', 'SIGNALLED']);
    expect(temporalAdvanced).toEqual([true, true, true]);
  });

  // Known defect INT-F3 (owner CMP-015): with no workflow engine the response must say so.
  it.fails(
    'CMP-015 reports DEFERRED_TO_OUTBOX and temporal_advanced=false when nothing was signalled',
    () => {
      expect(advances).toEqual(['DEFERRED_TO_OUTBOX', 'DEFERRED_TO_OUTBOX', 'DEFERRED_TO_OUTBOX']);
      expect(temporalAdvanced).toEqual([false, false, false]);
    },
  );

  it('no CMP-016 workflow instance, request or outbox row exists for the case (sf_workflow empty)', async () => {
    const r = await admin().query<{ t: string; n: string }>(
      `SELECT 'workflow_instance' AS t, count(*) AS n FROM sf_workflow.workflow_instance
       UNION ALL SELECT 'workflow_request', count(*) FROM sf_workflow.workflow_request
       UNION ALL SELECT 'outbox_event', count(*) FROM sf_workflow.outbox_event
       UNION ALL SELECT 'outbox_event_platform', count(*) FROM sf_workflow.outbox_event_platform`,
    );
    expect(r.rows).toHaveLength(4);
    for (const row of r.rows) expect(Number(row.n), `sf_workflow.${row.t}`).toBe(0);
  });

  it('the host is configured without a Temporal endpoint', () => {
    const keys = readFileSync(LAB_ENV_FILE(), 'utf8')
      .split('\n')
      .map((l) => l.slice(0, l.indexOf('=')))
      .filter(Boolean);
    expect(keys.some((k) => /TEMPORAL|WORKFLOW/.test(k))).toBe(false);
  });

  it('the officer action is OPA-authorized and records the decision id and policy revision', async () => {
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officer.token,
    });
    const last = must((tr.body['transitions'] as Record<string, unknown>[]).at(-1));
    expect(last['command']).toBe('MARK_RECEIVED');
    expect(last['actor_type']).toBe('OFFICER');
    expect(String(last['authz_decision_id'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(last['authz_policy_revision']).toBe('m10-b1');
  });
});
