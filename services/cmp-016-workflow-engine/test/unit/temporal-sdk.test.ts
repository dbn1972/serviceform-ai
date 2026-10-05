import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type Client,
} from '@temporalio/client';
import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  SIGNAL_COMMITTED,
  SIGNAL_MIGRATE,
  WORKFLOW_TYPE,
  temporalWorkflowId,
} from '../../src/index.js';
import {
  MAX_TIMER_MS,
  TemporalSdkClient,
  createCanonicalActivities,
} from '../../src/temporal/sdk/index.js';
import { Ports } from '../doubles/ports.js';
import { APP, T1, startInput } from '../fixtures/models.js';

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code ?? err.code;
    throw err;
  }
  return undefined;
}

function fakeClient(behaviour: { startError?: unknown; signalError?: unknown } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const client = {
    workflow: {
      async start(type: string, opts: unknown) {
        calls.push({ op: 'start', args: [type, opts] });
        if (behaviour.startError) throw behaviour.startError;
        return { firstExecutionRunId: 'run-1' };
      },
      getHandle(id: string) {
        return {
          async signal(name: string, payload: unknown) {
            calls.push({ op: 'signal', args: [id, name, payload] });
            if (behaviour.signalError) throw behaviour.signalError;
          },
        };
      },
    },
  } as unknown as Client;
  return { client, calls };
}

const WF_ID = temporalWorkflowId(T1, APP);
const startReq = {
  workflowId: WF_ID,
  taskQueue: 'sf-workflow',
  workflowType: WORKFLOW_TYPE,
  args: [startInput()],
};

describe('TemporalSdkClient (production TemporalClientPort) fails closed', () => {
  it('starts only the canonical type on the configured queue with REJECT_DUPLICATE + FAIL', async () => {
    const { client, calls } = fakeClient();
    const c = new TemporalSdkClient(client, 'sf-workflow');
    expect(await c.start(startReq)).toEqual({ runId: 'run-1' });
    const [type, opts] = calls[0]?.args as [string, Record<string, unknown>];
    expect(type).toBe(WORKFLOW_TYPE);
    expect(opts).toMatchObject({
      workflowId: WF_ID,
      taskQueue: 'sf-workflow',
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
    });
  });

  it('rejects other workflow types, queues, ids and signal names before any SDK call', async () => {
    const { client, calls } = fakeClient();
    const c = new TemporalSdkClient(client, 'sf-workflow');
    expect(await code(c.start({ ...startReq, workflowType: 'bpmnProcess' }))).toBe(
      'WORKFLOW_TYPE_NOT_ALLOWED',
    );
    expect(await code(c.start({ ...startReq, taskQueue: 'other-queue' }))).toBe(
      'TASK_QUEUE_MISMATCH',
    );
    expect(await code(c.start({ ...startReq, workflowId: 'sf-wf:x:y' }))).toBe(
      'WORKFLOW_ID_INVALID',
    );
    expect(await code(c.start({ ...startReq, workflowId: `sf-wf:${T1}` }))).toBe(
      'WORKFLOW_ID_INVALID',
    );
    expect(await code(c.signal(WF_ID, 'sf.updateCaseState', {}))).toBe('SIGNAL_NOT_ALLOWED');
    expect(await code(c.signal('free-form', SIGNAL_COMMITTED, {}))).toBe('WORKFLOW_ID_INVALID');
    expect(calls).toEqual([]);
    await c.signal(WF_ID, SIGNAL_COMMITTED, { a: 1 });
    await c.signal(WF_ID, SIGNAL_MIGRATE, { b: 2 });
    expect(calls.map((x) => x.args[1])).toEqual([SIGNAL_COMMITTED, SIGNAL_MIGRATE]);
    expect(await code(() => new TemporalSdkClient(client, 'Bad Queue!'))).toBe(
      'TASK_QUEUE_INVALID',
    );
  });

  it('maps SDK failures to fail-closed platform errors', async () => {
    const dup = new WorkflowExecutionAlreadyStartedError('exists', WF_ID, WORKFLOW_TYPE);
    expect(
      await code(
        new TemporalSdkClient(fakeClient({ startError: dup }).client, 'sf-workflow').start(
          startReq,
        ),
      ),
    ).toBe('WORKFLOW_ALREADY_STARTED');
    const gone = new WorkflowNotFoundError('gone', WF_ID, undefined);
    expect(
      await code(
        new TemporalSdkClient(fakeClient({ signalError: gone }).client, 'sf-workflow').signal(
          WF_ID,
          SIGNAL_COMMITTED,
          {},
        ),
      ),
    ).toBe('WORKFLOW_NOT_RUNNING');
    const down = new Error('connect ECONNREFUSED');
    expect(
      await code(
        new TemporalSdkClient(fakeClient({ startError: down }).client, 'sf-workflow').start(
          startReq,
        ),
      ),
    ).toBe('TEMPORAL_UNAVAILABLE');
  });
});

describe('canonical activities', () => {
  const deps = (ms: number) => {
    const ports = new Ports();
    const progress: unknown[] = [];
    const acts = createCanonicalActivities({
      ports: { ...ports, timers: { durationMs: async () => ms } },
      systemActorId: '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e',
      recordProgress: async (ctx, input) => {
        progress.push({ actor: ctx.actor, input });
      },
    });
    return { acts, ports, progress };
  };

  it('bounds timer durations resolved from SLA policy', async () => {
    const effect = { type: 'START_TIMER' as const, node_id: 'T', token_id: 1 };
    expect(await deps(5000).acts.timerDuration(startInput(), effect)).toBe(5000);
    for (const bad of [0, -1, Number.NaN, MAX_TIMER_MS + 1]) {
      expect(await code(deps(bad).acts.timerDuration(startInput(), effect))).toBe(
        'TIMER_DURATION_INVALID',
      );
    }
  });

  it('runs as the SYSTEM workload identity and records only the sequencing projection', async () => {
    const { acts, ports, progress } = deps(1000);
    const ev = await acts.evaluateRule(startInput(), {
      type: 'EVALUATE_RULE',
      node_id: 'ELIGIBILITY',
      token_id: 1,
      rule_ref: 'r:1',
    });
    expect(ev).toEqual({
      type: 'RESULT',
      node_id: 'ELIGIBILITY',
      kind: 'RULE',
      outcome: 'ELIGIBLE',
    });
    await acts.invokePort(startInput(), {
      type: 'INVOKE_PORT',
      node_id: 'N',
      token_id: 2,
      port: 'NOTIFY',
    });
    await acts.invokeActivity(startInput(), {
      type: 'INVOKE_ACTIVITY',
      node_id: 'A',
      token_id: 3,
      kind: 'SERVICE_ACTIVITY',
    });
    await acts.createHumanTask(startInput(), {
      type: 'CREATE_HUMAN_TASK',
      node_id: 'SCRUTINY',
      token_id: 4,
      assignment: { role_code: 'ROLE_A', organisation_id: T1, jurisdiction_id: T1 },
    });
    await acts.closeHumanTask(startInput(), {
      type: 'CLOSE_HUMAN_TASK',
      node_id: 'SCRUTINY',
      token_id: 4,
    });
    expect(ports.log).toEqual([
      'rule:r:1',
      'port:NOTIFY:N',
      'activity:A',
      `task.create:SCRUTINY:wf.${APP}.SCRUTINY.4.create`,
      'task.close:SCRUTINY',
    ]);
    await acts.recordProgress(startInput(), {
      workflow_version_id: startInput().workflow_version_id,
      graph_hash: startInput().graph_hash,
      status: 'RUNNING',
      tokens: [],
      joins: {},
      next_token_id: 1,
      seen_signals: ['s1', 's2'],
    });
    expect(progress[0]).toMatchObject({
      actor: { type: 'SYSTEM' },
      input: { application_id: APP, last_signal_id: 's2' },
    });
  });
});
