import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { Worker } from '@temporalio/worker';
import { WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  TemporalSequencingAdapter,
  WORKFLOW_TYPE,
  WorkflowService,
  exportBpmn,
  temporalWorkflowId,
  withTenantTx,
  type CommandTransitionRecord,
  type HumanTaskPort,
  type InstanceState,
  type WorkflowVersionRecord,
} from '../../src/index.js';
import {
  CANONICAL_ACTIVITY_NAMES,
  QUERY_STATE,
  TemporalSdkClient,
  bundleCanonicalWorkflows,
  createCanonicalActivities,
  createCanonicalWorker,
} from '../../src/temporal/sdk/index.js';
import { Approvals, Authz, Ports, ctx } from '../doubles/ports.js';
import {
  ASSIGN,
  T1,
  T2,
  committed,
  frozenExample,
  linearGraph,
  model,
  richGraph,
  startInput,
} from '../fixtures/models.js';
import {
  asSqlPool,
  closeHarness,
  errorOf,
  setupHarness,
  type Harness,
} from '../integration/helpers.js';

const TASK_QUEUE = 'sf-workflow-sdk-test';
const SYSTEM_ACTOR = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';

interface History {
  events?: Record<string, unknown>[] | null;
}

let env: TestWorkflowEnvironment;
let h: Harness;
let worker: Worker;
let running: Promise<void>;
let svc: WorkflowService;
let adapter: TemporalSequencingAdapter;
let sdkClient: TemporalSdkClient;
let v1: WorkflowVersionRecord;
let v2: WorkflowVersionRecord;
const ports = new Ports();
const taskCalls: { op: 'create' | 'close'; app: string; node: string; key: string }[] = [];
let failCreatesFor: string | null = null;

const humanTasks: HumanTaskPort = {
  async create(_c, r) {
    taskCalls.push({
      op: 'create',
      app: r.application_id,
      node: r.workflow_node_id,
      key: r.idempotency_key,
    });
    if (failCreatesFor === r.application_id) {
      failCreatesFor = null;
      throw new Error('CMP-017 temporarily unavailable');
    }
  },
  async cancelClose(_c, r) {
    taskCalls.push({
      op: 'close',
      app: r.application_id,
      node: r.workflow_node_id,
      key: r.idempotency_key,
    });
  },
};
let timerMs = 1000;

function transition(
  app: string,
  versionId: string,
  commandType: string,
  over: Partial<CommandTransitionRecord> = {},
) {
  const base = frozenExample('valid', 'command-transition') as unknown as CommandTransitionRecord;
  return {
    ...base,
    tenant_id: T1,
    application_id: app,
    command_id: randomUUID(),
    command_type: commandType,
    pin_set: { ...base.pin_set, workflow_version_id: versionId },
    ...over,
  } as CommandTransitionRecord;
}

function handleOf(app: string, tenant = T1): WorkflowHandle {
  return env.client.workflow.getHandle(temporalWorkflowId(tenant, app));
}

async function history(handle: WorkflowHandle): Promise<Record<string, unknown>[]> {
  return ((await handle.fetchHistory()) as History).events ?? [];
}

function count(
  events: Record<string, unknown>[],
  attr: string,
  pred: (a: Record<string, unknown>) => boolean = () => true,
) {
  return events.filter((e) => e[attr] != null && pred(e[attr] as Record<string, unknown>)).length;
}

const activityName = (a: Record<string, unknown>) =>
  (a['activityType'] as { name?: string } | undefined)?.name;

/** Waits until no workflow task or activity is outstanding and every signal has been processed. */
async function settle(handle: WorkflowHandle): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < 400; i += 1) {
    const ev = await history(handle);
    const closed = ev.some(
      (e) =>
        e['workflowExecutionCompletedEventAttributes'] ||
        e['workflowExecutionFailedEventAttributes'],
    );
    const wtScheduled = count(ev, 'workflowTaskScheduledEventAttributes');
    const wtDone =
      count(ev, 'workflowTaskCompletedEventAttributes') +
      count(ev, 'workflowTaskFailedEventAttributes') +
      count(ev, 'workflowTaskTimedOutEventAttributes');
    const actScheduled = count(ev, 'activityTaskScheduledEventAttributes');
    const actDone =
      count(ev, 'activityTaskCompletedEventAttributes') +
      count(ev, 'activityTaskFailedEventAttributes') +
      count(ev, 'activityTaskTimedOutEventAttributes');
    const lastSignal = ev
      .map((e) => !!e['workflowExecutionSignaledEventAttributes'])
      .lastIndexOf(true);
    const lastWtc = ev.map((e) => !!e['workflowTaskCompletedEventAttributes']).lastIndexOf(true);
    if (
      closed ||
      (wtScheduled === wtDone && actScheduled === actDone && lastWtc > lastSignal && lastWtc > 0)
    ) {
      return ev;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('workflow did not settle');
}

async function state(app: string): Promise<InstanceState> {
  return handleOf(app).query<InstanceState>(QUERY_STATE);
}

async function startAt(app: string, version: WorkflowVersionRecord = v1) {
  await svc.startInstance(ctx(), { application_id: app, workflow_version_id: version.version_id });
  return settle(handleOf(app));
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code ?? err.code;
    if (err instanceof WorkflowFailedError) return (err.cause as Error | undefined)?.message;
    throw err;
  }
  return undefined;
}

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  h = await setupHarness();
  sdkClient = new TemporalSdkClient(env.client, TASK_QUEUE);
  adapter = new TemporalSequencingAdapter(sdkClient, TASK_QUEUE);
  svc = new WorkflowService({
    pool: asSqlPool(h.rt),
    authz: new Authz(),
    approvals: new Approvals(),
    temporal: adapter,
  });
  const timers = { durationMs: async () => timerMs };
  worker = await createCanonicalWorker({
    connection: env.nativeConnection,
    namespace: env.namespace ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowBundle: await bundleCanonicalWorkflows(),
    activities: createCanonicalActivities({
      ports: {
        ...ports,
        humanTasks,
        timers,
        rules: ports.rules,
        activities: ports.activities,
        processPorts: ports.processPorts,
      },
      systemActorId: SYSTEM_ACTOR,
      recordProgress: (c, i) => svc.recordProgress(c, i),
    }),
  });
  running = worker.run();
  const { definition_id } = await svc.createDefinition(ctx(), { definition_key: 'sdk.flow' });
  const d1 = await svc.createDraft(ctx(), { definition_id, graph: richGraph() });
  v1 = await svc.publish(ctx(), { version_id: d1.version_id, approval_ref: 'mc:approval:1' });
  const g2 = richGraph();
  g2.edges = g2.edges.filter((e) => e.from_node !== 'ISSUE_PORT' && e.to_node !== 'ISSUE_PORT');
  g2.nodes = g2.nodes.filter((n) => n.node_id !== 'ISSUE_PORT');
  const d2 = await svc.createDraft(ctx(), { definition_id, graph: g2 });
  v2 = await svc.publish(ctx(), { version_id: d2.version_id, approval_ref: 'mc:approval:2' });
});

afterAll(async () => {
  worker?.shutdown();
  await running?.catch(() => undefined);
  await env?.teardown();
  await closeHarness(h);
});

describe('Temporal SDK binding: worker, client, signals, timers, activities (time-skipping server)', () => {
  it('start uses the canonical workflow type, task queue and a tenant+application workflow id', async () => {
    const app = randomUUID();
    await startAt(app);
    const desc = await handleOf(app).describe();
    expect(desc.workflowId).toBe(`sf-wf:${T1}:${app}`);
    expect(desc.type).toBe(WORKFLOW_TYPE);
    expect(desc.taskQueue).toBe(TASK_QUEUE);
    expect(desc.status.name).toBe('RUNNING');
    const s = await state(app);
    expect(s.workflow_version_id).toBe(v1.version_id);
    const row = await h.admin.query<{ active_nodes: string[] }>(
      'SELECT active_nodes FROM sf_workflow.workflow_instance WHERE application_id = $1',
      [app],
    );
    expect(row.rows[0]?.active_nodes).toEqual(['SCRUTINY', 'SLA_TIMER']);
    expect(
      await code(
        svc.startInstance(ctx(), { application_id: app, workflow_version_id: v1.version_id }),
      ),
    ).toBe('SF-APP-002');
    expect(
      await code(
        sdkClient.start({
          workflowId: desc.workflowId,
          taskQueue: TASK_QUEUE,
          workflowType: WORKFLOW_TYPE,
          args: [startInput(v1.model)],
        }),
      ),
    ).toBe('WORKFLOW_ALREADY_STARTED');
  });

  it('committed CMP-015 transition reaches the running workflow; duplicate delivery has no duplicate effects', async () => {
    const app = randomUUID();
    await startAt(app);
    const rec = transition(app, v1.version_id, 'COMPLETE_SCRUTINY');
    const evt = randomUUID();
    await svc.onCaseTransitionCommitted(ctx(), rec, evt);
    await settle(handleOf(app));
    expect((await state(app)).tokens.map((t) => t.node_id)).not.toContain('SCRUTINY');
    await svc.onCaseTransitionCommitted(ctx(), rec, evt);
    const ev = await settle(handleOf(app));
    expect(count(ev, 'workflowExecutionSignaledEventAttributes')).toBe(2);
    expect(
      count(
        ev,
        'activityTaskScheduledEventAttributes',
        (a) => activityName(a) === 'closeHumanTask',
      ),
    ).toBe(1);
    expect(taskCalls.filter((c) => c.app === app && c.op === 'close')).toHaveLength(1);
    expect((await state(app)).seen_signals).toEqual([rec.command_id]);
  });

  it('NEGATIVE: a failed CMP-015 commit cannot advance Temporal (service path and raw signal)', async () => {
    const app = randomUUID();
    await startAt(app);
    const before = await state(app);
    const failed = transition(app, v1.version_id, 'COMPLETE_SCRUTINY', { domain_committed: false });
    expect(await code(svc.onCaseTransitionCommitted(ctx(), failed, randomUUID()))).toBe(
      'ADVANCE_BEFORE_DOMAIN_COMMIT',
    );
    expect(count(await history(handleOf(app)), 'workflowExecutionSignaledEventAttributes')).toBe(0);
    await handleOf(app).signal(
      'sf.committedTransition',
      committed('COMPLETE_SCRUTINY', {
        application_id: app,
        workflow_version_id: v1.version_id,
        domain_committed: false,
      }),
    );
    await settle(handleOf(app));
    expect(await state(app)).toEqual(before);
  });

  it('NEGATIVE: no Temporal call inside an open domain transaction', async () => {
    const app = randomUUID();
    await startAt(app);
    const signal = committed('COMPLETE_SCRUTINY', {
      application_id: app,
      workflow_version_id: v1.version_id,
    });
    expect(
      await code(withTenantTx(asSqlPool(h.rt), ctx(), () => adapter.advance(ctx(), signal))),
    ).toBe('TEMPORAL_CALL_INSIDE_DOMAIN_TXN');
    expect(count(await history(handleOf(app)), 'workflowExecutionSignaledEventAttributes')).toBe(0);
  });

  it('NEGATIVE: a signal scoped to another tenant or application is rejected inside the workflow', async () => {
    const app = randomUUID();
    await startAt(app);
    const before = await state(app);
    await handleOf(app).signal(
      'sf.committedTransition',
      committed('COMPLETE_SCRUTINY', {
        tenant_id: T2,
        application_id: app,
        workflow_version_id: v1.version_id,
      }),
    );
    await settle(handleOf(app));
    expect(await state(app)).toEqual(before);
    expect(await code(adapter.advance(ctx(), committed('X1', { tenant_id: T2 })))).toBe(
      'SF-TEN-002',
    );
  });

  it('durable wait and durable Temporal timers (no setTimeout): survives skipped days, fires, then completes', async () => {
    const app = randomUUID();
    timerMs = 3 * 24 * 60 * 60 * 1000;
    let ev = await startAt(app);
    timerMs = 1000;
    const started = ev.find((e) => e['timerStartedEventAttributes']);
    const fire = (
      started?.['timerStartedEventAttributes'] as { startToFireTimeout?: { seconds?: unknown } }
    ).startToFireTimeout;
    expect(Number(fire?.seconds)).toBe(3 * 24 * 60 * 60);
    expect(count(ev, 'timerFiredEventAttributes')).toBe(0);
    await env.sleep('4 days');
    ev = await settle(handleOf(app));
    expect(count(ev, 'timerFiredEventAttributes')).toBe(1);
    expect(
      count(ev, 'activityTaskScheduledEventAttributes', (a) => activityName(a) === 'invokePort'),
    ).toBe(1);
    expect((await handleOf(app).describe()).status.name).toBe('RUNNING');
    expect((await state(app)).tokens.map((t) => t.node_id)).toEqual(['SCRUTINY']);
    await svc.onCaseTransitionCommitted(
      ctx(),
      transition(app, v1.version_id, 'COMPLETE_SCRUTINY'),
      randomUUID(),
    );
    const final = await handleOf(app).result();
    expect(final.status).toBe('COMPLETED');
  });

  it('withdrawal: CMP-016 request record -> review -> CMP-015 commit terminates and cancels the durable timer', async () => {
    const app = randomUUID();
    timerMs = 2 * 24 * 60 * 60 * 1000;
    await startAt(app);
    timerMs = 1000;
    await svc.submitRequest(ctx(), {
      application_id: app,
      request_kind: 'WITHDRAWAL',
      outcome: 'CITIZEN_WITHDRAW',
      idempotency_key: `idem-${app.slice(0, 8)}`,
    });
    await settle(handleOf(app));
    expect((await state(app)).tokens.map((t) => t.node_id).sort()).toEqual([
      'SLA_TIMER',
      'WITHDRAW_REV',
    ]);
    await svc.onCaseTransitionCommitted(
      ctx(),
      transition(app, v1.version_id, 'COMMIT_WITHDRAWAL'),
      randomUUID(),
    );
    const final = await handleOf(app).result();
    expect(final).toMatchObject({ status: 'TERMINATED', terminated_by: 'WITHDRAWAL_REVIEW' });
    const ev = await history(handleOf(app));
    expect(count(ev, 'timerCanceledEventAttributes')).toBe(1);
    expect(count(ev, 'timerFiredEventAttributes')).toBe(0);
  });

  it('sf.migrate reaches the running workflow only through an approved, committed plan', async () => {
    const app = randomUUID();
    await startAt(app);
    const plan = await svc.approveMigration(ctx(), {
      from_version_id: v1.version_id,
      to_version_id: v2.version_id,
      node_mapping: { SCRUTINY: 'SCRUTINY', SLA_TIMER: 'SLA_TIMER' },
      approval_ref: 'mc:migration:sdk',
      simulation_evidence_ref: 'evidence/simulation/sdk',
      requested_by: ctx().actor.id,
    });
    await svc.applyMigration(ctx(), { application_id: app, migration_id: plan.migration_id });
    const ev = await settle(handleOf(app));
    expect(
      count(
        ev,
        'workflowExecutionSignaledEventAttributes',
        (a) => a['signalName'] === 'sf.migrate',
      ),
    ).toBe(1);
    expect((await state(app)).workflow_version_id).toBe(v2.version_id);
    await svc.onCaseTransitionCommitted(
      ctx(),
      transition(app, v2.version_id, 'COMPLETE_SCRUTINY'),
      randomUUID(),
    );
    await settle(handleOf(app));
    expect((await state(app)).tokens.map((t) => t.node_id)).not.toContain('SCRUTINY');
  });

  it('activities are retry-safe: a failed CMP-017 call is retried with the same idempotency key', async () => {
    const app = randomUUID();
    failCreatesFor = app;
    await startAt(app);
    const creates = taskCalls.filter((c) => c.app === app && c.op === 'create');
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map((c) => c.key)).size).toBe(1);
    const key = creates[0]?.key ?? '';
    expect(key.startsWith(`wf.${app}.SCRUTINY.`) && key.endsWith('.create')).toBe(true);
    const ev = await history(handleOf(app));
    expect(
      count(
        ev,
        'activityTaskScheduledEventAttributes',
        (a) => activityName(a) === 'createHumanTask',
      ),
    ).toBe(1);
  });

  it('NEGATIVE: Temporal cannot update CMP-015 state - activities are ports + own projection only', async () => {
    expect([...CANONICAL_ACTIVITY_NAMES].sort()).toEqual([
      'closeHumanTask',
      'createHumanTask',
      'evaluateRule',
      'invokeActivity',
      'invokePort',
      'recordProgress',
      'timerDuration',
    ]);
    for (const n of CANONICAL_ACTIVITY_NAMES)
      expect(n).not.toMatch(/case|application|transition|commit|status/i);
    const others = await h.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE c.relkind = 'r' AND ns.nspname LIKE 'sf\\_%' ESCAPE '\\' AND ns.nspname <> 'sf_workflow'
          AND (has_table_privilege('sf_t016_rt', c.oid, 'UPDATE') OR has_table_privilege('sf_t016_rt', c.oid, 'DELETE'))`,
    );
    expect(others.rows[0]?.n).toBe(0);
  });

  it('NEGATIVE: BPMN import is not a second engine', async () => {
    const { definition_id } = await svc.createDefinition(ctx(), {
      definition_key: `sdk.bpmn.${randomUUID().slice(0, 8)}`,
    });
    const imported = await svc.importBpmnDraft(ctx(), { definition_id, xml: exportBpmn(model()) });
    const app = randomUUID();
    expect(
      await code(
        svc.startInstance(ctx(), { application_id: app, workflow_version_id: imported.version_id }),
      ),
    ).toBe('VERSION_NOT_PUBLISHED');
    expect((await errorOf(handleOf(app).describe())).message).toMatch(/not found/i);
    expect(
      await code(
        sdkClient.start({
          workflowId: temporalWorkflowId(T1, app),
          taskQueue: TASK_QUEUE,
          workflowType: 'bpmnProcess',
          args: [],
        }),
      ),
    ).toBe('WORKFLOW_TYPE_NOT_ALLOWED');
    const rawBpmn = env.client.workflow.execute(WORKFLOW_TYPE, {
      taskQueue: TASK_QUEUE,
      workflowId: `raw-bpmn-${app}`,
      args: [{ ...startInput(), model: exportBpmn(model()) }],
    });
    expect(await code(rawBpmn)).toBe('MODEL_INVALID');
    const engine = env.client.workflow.execute(WORKFLOW_TYPE, {
      taskQueue: TASK_QUEUE,
      workflowId: `raw-engine-${app}`,
      args: [{ ...startInput(), model: { ...model(), runtime: 'BPMN_ENGINE' } }],
    });
    expect(await code(engine)).toBe('BPMN_RUNTIME_FORBIDDEN');
  });

  it('NEGATIVE: named officer assignment is still rejected (service and inside the worker)', async () => {
    const g = linearGraph();
    (g.nodes[1] as { assignment: unknown }).assignment = { ...ASSIGN, officer_name: 'A Person' };
    const { definition_id } = await svc.createDefinition(ctx(), {
      definition_key: `sdk.officer.${randomUUID().slice(0, 8)}`,
    });
    expect(await code(svc.createDraft(ctx(), { definition_id, graph: g }))).toBe(
      'NAMED_OFFICER_FORBIDDEN',
    );
    const m = { ...model(linearGraph()), nodes: g.nodes };
    const raw = env.client.workflow.execute(WORKFLOW_TYPE, {
      taskQueue: TASK_QUEUE,
      workflowId: `raw-officer-${randomUUID()}`,
      args: [{ ...startInput(), model: m }],
    });
    expect(await code(raw)).toBe('NAMED_OFFICER_FORBIDDEN');
  });
});
