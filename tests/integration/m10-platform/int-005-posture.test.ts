import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Connection } from '@temporalio/client';
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
  outboxFor,
  putWorkingData,
  readJson,
  ROOT,
  syntheticForm,
  syntheticMobile,
  type App,
  type CitizenSession,
  type OfficerSession,
  must,
  TSB_A,
} from './support/platform.js';

/**
 * INT-005 (Application → Temporal → officer task → OPA-authorized action) on the Phase B host
 * since SF-M10-B-2c: CMP-016 is composed and every committed CMP-015 transition is signalled to
 * Temporal after the CMP-015 commit. CMP-015 stays authoritative: officers still act through
 * CMP-015 commands and the CMP-016 instance only follows. Remaining INT-005 gap: no CMP-017
 * officer task is created by the workflow (the SAMPLE_LAB graph has WAIT nodes only).
 */
const PINNED_WORKFLOW_VERSION = '0d15ba00-0012-4000-8000-0d15ba000012';
const CONSUMER = 'cmp-016.case-transitions';
const COMMANDS = ['MARK_READY_TO_SUBMIT', 'SUBMIT', 'MARK_RECEIVED'] as const;

function labEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(LAB_ENV_FILE(), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

interface InstanceRow {
  instance_id: string;
  tenant_id: string;
  workflow_version_id: string;
  graph_hash: string;
  temporal_workflow_id: string;
  status: string;
  active_nodes: string[];
  last_signal_id: string | null;
}

async function instanceFor(applicationId: string): Promise<InstanceRow | undefined> {
  const r = await admin().query<InstanceRow>(
    `SELECT instance_id, tenant_id, workflow_version_id, graph_hash, temporal_workflow_id, status,
            active_nodes, last_signal_id
       FROM sf_workflow.workflow_instance WHERE application_id = $1`,
    [applicationId],
  );
  return r.rows[0];
}

async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 40 && !ok(value); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    value = await read();
  }
  return value;
}

describe('INT-005: CMP-016 Temporal sequencing follows committed CMP-015 transitions', () => {
  let citizen: CitizenSession;
  let officer: OfficerSession;
  let app: App;
  const advances: unknown[] = [];
  const transitions: Record<string, unknown>[] = [];

  beforeAll(async () => {
    citizen = await citizenLogin(HOST_A(), syntheticMobile());
    officer = await officerLogin(HOST_A(), FIXTURE_A().officer.subject);
    app = (await createDraft(HOST_A(), citizen.token, TSB_A())).body['application'] as App;
    await putWorkingData(HOST_A(), citizen.token, app, syntheticForm(), 0);
    for (const cmd of COMMANDS) {
      const token = cmd === 'MARK_RECEIVED' ? officer.token : citizen.token;
      const r = await command(HOST_A(), token, app, cmd);
      expect(r.status).toBe(200);
      advances.push(r.body['workflow_advance']);
      transitions.push(r.body['command_transition'] as Record<string, unknown>);
      app = r.body['application'] as App;
    }
  });
  afterAll(closeAdmin);

  it('reports SIGNALLED / temporal_advanced=true only after CMP-016 delivered the signal', () => {
    expect(advances).toEqual(['SIGNALLED', 'SIGNALLED', 'SIGNALLED']);
    for (const t of transitions) {
      expect(t['temporal_advanced']).toBe(true);
      expect(t['domain_committed']).toBe(true);
      expect(t['phase']).toBe('TEMPORAL_ADVANCE');
    }
  });

  it('creates one RUNNING workflow instance pinned to the TSB workflow version', async () => {
    const inst = must(await instanceFor(app.application_id), 'workflow_instance');
    expect(inst.workflow_version_id).toBe(PINNED_WORKFLOW_VERSION);
    expect(inst.status).toBe('RUNNING');
    expect(inst.temporal_workflow_id).toBe(`sf-wf:${inst.tenant_id}:${app.application_id}`);
    const v = await admin().query<{ status: string; graph_hash: string }>(
      `SELECT status, model->>'graph_hash' AS graph_hash FROM sf_workflow.workflow_version
        WHERE tenant_id = $1 AND version_id = $2`,
      [inst.tenant_id, PINNED_WORKFLOW_VERSION],
    );
    expect(v.rows[0]?.status).toBe('PUBLISHED');
    expect(inst.graph_hash).toBe(v.rows[0]?.graph_hash);
  });

  it('the instance follows the case: active node WAIT_RECEIVED, last signal = MARK_RECEIVED command', async () => {
    const last = must(transitions.at(-1));
    const inst = await eventually(
      () => instanceFor(app.application_id),
      (i) => i?.last_signal_id === last['command_id'],
    );
    expect(inst?.last_signal_id).toBe(last['command_id']);
    expect(inst?.active_nodes).toEqual(['WAIT_RECEIVED']);
  });

  it('CMP-016 consumed exactly the committed CMP-015 ApplicationStateChanged outbox events', async () => {
    const inbox = await admin().query<{ event_id: string }>(
      `SELECT event_id FROM sf_workflow.inbox_event WHERE consumer_group = $1 AND event_id = ANY($2::uuid[])`,
      [CONSUMER, (await outboxFor(app.application_id)).map((r) => String(r.envelope['event_id']))],
    );
    const stateChanged = (await outboxFor(app.application_id))
      .filter((r) => r.event_type === 'ApplicationStateChanged')
      .map((r) => String(r.envelope['event_id']));
    expect(stateChanged).toHaveLength(COMMANDS.length);
    expect(inbox.rows.map((r) => r.event_id).sort()).toEqual([...stateChanged].sort());
  });

  it('Temporal holds the execution and received one committed-transition signal per command', async () => {
    const env = labEnv();
    const connection = await Connection.connect({ address: must(env['SF_TEMPORAL_ADDRESS']) });
    try {
      const client = new Client({
        connection,
        namespace: env['SF_TEMPORAL_NAMESPACE'] ?? 'default',
      });
      const inst = must(await instanceFor(app.application_id));
      const handle = client.workflow.getHandle(inst.temporal_workflow_id);
      const d = await handle.describe();
      expect(d.status.name).toBe('RUNNING');
      expect(d.type).toBe('serviceformCanonicalWorkflow');
      expect(d.taskQueue).toBe(env['SF_TEMPORAL_TASK_QUEUE']);
      const history = await handle.fetchHistory();
      const signals = (history.events ?? []).filter(
        (e) => e.workflowExecutionSignaledEventAttributes?.signalName === 'sf.committedTransition',
      );
      expect(signals).toHaveLength(COMMANDS.length);
    } finally {
      await connection.close();
    }
  });

  it('the host is configured with a Temporal endpoint and its own CMP-016 runtime login', () => {
    const env = labEnv();
    expect(env['SF_TEMPORAL_ADDRESS']).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(env['SF_TEMPORAL_TASK_QUEUE']).toBeTruthy();
    expect(new URL(must(env['DATABASE_URL_CMP016'])).username).toBe('sf_lab_cmp016');
  });

  it('the officer action is OPA-authorized through CMP-015 and records the decision', async () => {
    const tr = await call(HOST_A(), 'GET', `/v1/applications/${app.application_id}/transitions`, {
      token: officer.token,
    });
    const last = must((tr.body['transitions'] as Record<string, unknown>[]).at(-1));
    expect(last['command']).toBe('MARK_RECEIVED');
    expect(last['actor_type']).toBe('OFFICER');
    expect(String(last['authz_decision_id'])).toMatch(/^[0-9a-f-]{36}$/);
    const meta = readJson<{ policy_revision: string }>(join(ROOT, 'policy/opa/sf/meta/data.json'));
    expect(last['authz_policy_revision']).toBe(meta.policy_revision);
  });

  it('a citizen cannot drive the officer-only command even though Temporal is sequencing', async () => {
    const r = await command(HOST_A(), citizen.token, app, 'ENTER_SCRUTINY');
    expect(r.status).toBe(403);
    expect((await instanceFor(app.application_id))?.active_nodes).toEqual(['WAIT_RECEIVED']);
  });
});
