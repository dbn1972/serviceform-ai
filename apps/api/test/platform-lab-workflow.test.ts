import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CommandPipeline,
  TRANSITIONS,
  WorkflowAdvanceGate,
  parsePinGraph,
} from '@serviceform/cmp-015-application-case';
import { describe, expect, it, vi } from 'vitest';
import {
  composeLabWorkflow,
  ensurePublishedWorkflow,
  LabWorkflowBridge,
  nameUuid,
  opaWorkflowAuthorizer,
  SimulatedWorkflowPublication,
  type Cmp016Module,
  type Cmp016SdkModule,
  type LabWorkflowFixture,
  type WorkflowContextLike,
  type WorkflowServiceLike,
} from '../src/platform/workflow.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const LAB = join(ROOT, 'fixtures/lab/platform');
const fixture = JSON.parse(readFileSync(join(LAB, 'workflow.json'), 'utf8')) as LabWorkflowFixture;
const binding = (
  JSON.parse(readFileSync(join(LAB, 'published-bindings.json'), 'utf8')) as {
    bindings: { tenant_id: string; catalogue_id: string; pins: Record<string, string> }[];
  }
).bindings[0]!;
const TENANT = binding.tenant_id;
const APP = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const CORR = 'c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0';
const OUTBOX = '0e0e0e0e-0e0e-40e0-80e0-0e0e0e0e0e0e';
const PIN = {
  tenant_id: TENANT,
  catalogue_id: binding.catalogue_id,
  workflow_version_id: binding.pins['workflow_version_id']!,
};

// Non-literal specifier: CMP-016 is loaded the same way the host loads it (runtime.ts).
const CMP016_SRC = new URL(
  '../../../services/cmp-016-workflow-engine/src/index.ts',
  import.meta.url,
).href;
const cmp016 = (await import(CMP016_SRC)) as Cmp016Module;

class Cmp016Error extends Error {
  override readonly name = 'Cmp016Error';
  constructor(
    readonly code: string,
    readonly details: { code: string }[] = [],
  ) {
    super(code);
  }
}

function ctx(actorId: string, tenantId = TENANT): WorkflowContextLike {
  return {
    tenant_id: tenantId,
    cell_id: 'cell-lab-1',
    actor: { type: 'SYSTEM', id: actorId },
    correlation_id: CORR,
    trace_id: CORR.replace(/-/g, ''),
  };
}

function committedPipeline() {
  const p = new CommandPipeline({
    tenantId: TENANT,
    applicationId: APP,
    commandType: 'MARK_RECEIVED',
    idempotencyKey: 'cmd-000001',
    correlationId: CORR,
  });
  p.authorized('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'm10-b2c');
  p.validated('SUBMITTED', parsePinGraph(binding.pins));
  p.domainTxnOpened();
  p.caseMutated();
  p.outboxWritten();
  return { p, receipt: p.committed(5) };
}

const signal = {
  to_state: 'RECEIVED',
  transition_key: 'SUBMITTED>RECEIVED',
  workflow_version_id: PIN.workflow_version_id,
  idempotency_key: `${APP}:5`,
  correlation_id: CORR,
  outbox_event_id: OUTBOX,
} as const;

function fakeService(overrides: Partial<WorkflowServiceLike> = {}): WorkflowServiceLike {
  return {
    createDefinition: vi.fn(),
    createDraft: vi.fn(),
    publish: vi.fn(),
    startInstance: vi.fn(async () => ({ instance_id: APP, temporal_workflow_id: 'x' })),
    onCaseTransitionCommitted: vi.fn(async () => ({
      temporal_advanced: true as const,
      signal_id: APP,
    })),
    recordProgress: vi.fn(),
    ...overrides,
  } as WorkflowServiceLike;
}

function bridgeOver(service: WorkflowServiceLike) {
  return new LabWorkflowBridge({
    service: () => service,
    cellId: 'cell-lab-1',
    workloadActorId: fixture.workload.actor_id,
  });
}

describe('SAMPLE_LAB workflow fixture (CMP-016 canonical graph)', () => {
  const wf = fixture.workflows[0]!;

  it('is SIMULATED, maker != checker, and its recorded graph_hash is the CMP-016 hash of the graph', () => {
    expect(fixture.simulation).toBe('SIMULATED');
    expect(fixture.publication.author_id).not.toBe(fixture.publication.approver_id);
    expect(cmp016.graphHash(cmp016.parseGraph(wf.graph))).toBe(wf.graph_hash);
  });

  it('only sequences CMP-015 ALWAYS_LEGAL transitions: every edge outcome is the committed command', () => {
    const graph = wf.graph as {
      nodes: { node_id: string; kind: string }[];
      edges: { from_node: string; to_node: string; outcome?: string }[];
    };
    expect(graph.nodes.map((n) => n.kind).filter((k) => k !== 'WAIT')).toEqual(['START', 'END']);
    const legal = new Set(
      TRANSITIONS.filter((t) => t.cls === 'ALWAYS_LEGAL').map(
        (t) => `WAIT_${t.from}>${t.to === 'CLOSED' ? 'END_CLOSED' : `WAIT_${t.to}`}:${t.command}`,
      ),
    );
    const edges = graph.edges
      .filter((e) => e.from_node !== 'START')
      .map((e) => `${e.from_node}>${e.to_node}:${e.outcome}`);
    expect(new Set(edges)).toEqual(legal);
  });
});

describe('CMP-016 authorization over OPA', () => {
  it('sends SF-CON-AUTHZ-DECISION input; only the workload identity carries the sequencer roles', async () => {
    const decide = vi.fn(async () => ({ allow: true, decision_id: 'd', policy_revision: 'r' }));
    const authz = opaWorkflowAuthorizer({ decide }, fixture.workload, () => new Date(0));
    await authz.authorize(ctx(fixture.workload.actor_id), 'WORKFLOW_SIGNAL_ADVANCE', {
      type: 'Application',
      id: APP,
    });
    expect(decide).toHaveBeenLastCalledWith({
      subject: {
        user_id: fixture.workload.actor_id,
        actor_type: 'SYSTEM',
        tenant_id: TENANT,
        roles: fixture.workload.roles,
        jurisdiction_ids: [],
        assurance: 'WORKLOAD_IDENTITY',
      },
      resource: {
        resource_type: 'Application',
        tenant_id: TENANT,
        classification: 'TENANT_SCOPED',
        application_id: APP,
      },
      action: 'WORKFLOW_SIGNAL_ADVANCE',
      environment: { request_time: '1970-01-01T00:00:00.000Z', trace_id: CORR.replace(/-/g, '') },
    });
    await authz.authorize(ctx('99999999-9999-4999-8999-999999999999'), 'WORKFLOW_SIGNAL_ADVANCE', {
      type: 'Application',
      id: 'not-a-uuid',
    });
    const [last] = decide.mock.lastCall as unknown as [
      { subject: { roles: string[] }; resource: Record<string, unknown> },
    ];
    expect(last.subject.roles).toEqual([]);
    expect(last.resource).not.toHaveProperty('application_id');
  });

  it('a PDP deny or error is not an allow', async () => {
    const deny = opaWorkflowAuthorizer(
      { decide: async () => ({ allow: false, decision_id: 'd', policy_revision: 'r' }) },
      fixture.workload,
    );
    expect(
      (
        await deny.authorize(ctx(fixture.workload.actor_id), 'WORKFLOW_INSTANCE_START', {
          type: 'Application',
        })
      ).allow,
    ).toBe(false);
    const broken = opaWorkflowAuthorizer(
      { decide: async () => Promise.reject(new Error('down')) },
      fixture.workload,
    );
    await expect(
      broken.authorize(ctx(fixture.workload.actor_id), 'WORKFLOW_INSTANCE_START', {
        type: 'Application',
      }),
    ).rejects.toThrow('down');
  });
});

describe('SIMULATED workflow publication (LOCAL/CI only)', () => {
  const publication = new SimulatedWorkflowPublication('LOCAL', fixture);
  const { author_id, approver_id } = fixture.publication;

  it('refuses outside LOCAL/CI and refuses a fixture without distinct maker and checker', () => {
    for (const env of ['PRODUCTION', 'UAT', 'STAGING', 'DEV']) {
      expect(() => new SimulatedWorkflowPublication(env, fixture)).toThrow(/refused/);
    }
    expect(() => new SimulatedWorkflowPublication('CI', fixture)).not.toThrow();
    expect(
      () =>
        new SimulatedWorkflowPublication('LOCAL', {
          ...fixture,
          publication: { author_id, approver_id: author_id },
        }),
    ).toThrow(/maker and checker/);
    expect(
      () =>
        new SimulatedWorkflowPublication('LOCAL', {
          ...fixture,
          simulation: 'REAL' as 'SIMULATED',
        }),
    ).toThrow(/SIMULATED/);
  });

  it('authorizes only the fixture author for authoring and only the approver for publish', async () => {
    const { authorize } = publication.authorizer();
    const allow = async (actor: string, action: string) =>
      (await authorize(ctx(actor), action, { type: 'WorkflowVersion' })).allow;
    expect(await allow(author_id, 'WORKFLOW_DEFINITION_CREATE')).toBe(true);
    expect(await allow(author_id, 'WORKFLOW_VERSION_DRAFT')).toBe(true);
    expect(await allow(author_id, 'WORKFLOW_VERSION_PUBLISH')).toBe(false);
    expect(await allow(approver_id, 'WORKFLOW_VERSION_PUBLISH')).toBe(true);
    expect(await allow(approver_id, 'WORKFLOW_VERSION_DRAFT')).toBe(false);
    for (const action of [
      'WORKFLOW_INSTANCE_START',
      'WORKFLOW_SIGNAL_ADVANCE',
      'WORKFLOW_VERSION_RETIRE',
    ]) {
      expect(await allow(author_id, action)).toBe(false);
      expect(await allow(approver_id, action)).toBe(false);
    }
    expect(await allow(fixture.workload.actor_id, 'WORKFLOW_DEFINITION_CREATE')).toBe(false);
  });

  it('approves only the pinned version, the recorded approval_ref and the exact graph_hash', async () => {
    const wf = fixture.workflows[0]!;
    const approvals = publication.approvals([PIN]);
    const ok = {
      subject_type: 'WorkflowVersion' as const,
      subject_id: PIN.workflow_version_id,
      content_hash: wf.graph_hash,
      approval_ref: wf.approval_ref,
    };
    const verdict = async (c: WorkflowContextLike, r: typeof ok) =>
      (await approvals.verify(c, r)).approved;
    expect(await verdict(ctx(approver_id), ok)).toBe(true);
    expect(
      await verdict(ctx(approver_id), { ...ok, content_hash: `sha256:${'0'.repeat(64)}` }),
    ).toBe(false);
    expect(await verdict(ctx(approver_id), { ...ok, approval_ref: 'other:ref' })).toBe(false);
    expect(await verdict(ctx(approver_id), { ...ok, subject_id: APP })).toBe(false);
    expect(await verdict(ctx(approver_id, '22222222-2222-4222-8222-222222222222'), ok)).toBe(false);
    expect(
      await verdict(ctx(approver_id), { ...ok, subject_type: 'WorkflowMigration' as never }),
    ).toBe(false);
  });
});

describe('ensurePublishedWorkflow (idempotent seed through the CMP-016 service)', () => {
  function serviceClass(publish: () => Promise<unknown>) {
    const calls: {
      op: string;
      ctx: WorkflowContextLike;
      input: unknown;
      id?: string | undefined;
    }[] = [];
    class FakeService {
      constructor(private readonly deps: { newId?: () => string }) {}
      async createDefinition(c: WorkflowContextLike, input: unknown) {
        calls.push({ op: 'createDefinition', ctx: c, input, id: this.deps.newId?.() });
        return { definition_id: 'd' };
      }
      async createDraft(c: WorkflowContextLike, input: unknown) {
        calls.push({ op: 'createDraft', ctx: c, input, id: this.deps.newId?.() });
        return { version_id: 'v' };
      }
      async publish(c: WorkflowContextLike, input: unknown) {
        calls.push({ op: 'publish', ctx: c, input });
        return publish();
      }
    }
    return { calls, WorkflowService: FakeService as unknown as Cmp016Module['WorkflowService'] };
  }
  const params = (WorkflowService: Cmp016Module['WorkflowService']) => ({
    cmp016: { WorkflowService },
    deps: { pool: {}, temporal: {} },
    publication: new SimulatedWorkflowPublication('LOCAL', fixture),
    fixture,
    pin: PIN,
    cellId: 'cell-lab-1',
  });

  it('creates definition and pinned draft, then publishes, when the version does not exist', async () => {
    let n = 0;
    const { calls, WorkflowService } = serviceClass(async () => {
      n += 1;
      if (n === 1) throw new Cmp016Error('SF-SYS-002');
      return { status: 'PUBLISHED' };
    });
    expect(await ensurePublishedWorkflow(params(WorkflowService))).toBe('PUBLISHED');
    expect(calls.map((c) => c.op)).toEqual([
      'publish',
      'createDefinition',
      'createDraft',
      'publish',
    ]);
    const definitionId = nameUuid(TENANT, fixture.workflows[0]!.definition_key);
    expect(calls[1]).toMatchObject({
      id: definitionId,
      ctx: { actor: { id: fixture.publication.author_id } },
    });
    expect(calls[2]).toMatchObject({
      id: PIN.workflow_version_id,
      input: { definition_id: definitionId, graph: fixture.workflows[0]!.graph },
    });
    expect(calls[3]?.ctx.actor.id).toBe(fixture.publication.approver_id);
  });

  it('leaves an already published (immutable) version untouched', async () => {
    const { calls, WorkflowService } = serviceClass(async () => {
      throw new Cmp016Error('SF-WF-001', [{ code: 'PUBLISHED_VERSION_IMMUTABLE' }]);
    });
    expect(await ensurePublishedWorkflow(params(WorkflowService))).toBe('ALREADY_PUBLISHED');
    expect(calls.map((c) => c.op)).toEqual(['publish']);
  });

  it('propagates any other refusal (fail closed: the host does not start)', async () => {
    const { WorkflowService } = serviceClass(async () => {
      throw new Cmp016Error('SF-AUTH-002', [{ code: 'APPROVAL_NOT_GRANTED' }]);
    });
    await expect(ensurePublishedWorkflow(params(WorkflowService))).rejects.toMatchObject({
      code: 'SF-AUTH-002',
    });
  });
});

describe('LabWorkflowBridge behind the CMP-015 post-commit gate', () => {
  it('SIGNALLED only after CMP-016 accepted the committed record and its outbox event id', async () => {
    const service = fakeService();
    const gate = new WorkflowAdvanceGate(bridgeOver(service));
    const { p, receipt } = committedPipeline();
    expect(await gate.advance(p, receipt, signal)).toBe('SIGNALLED');
    expect(p.record()).toMatchObject({ phase: 'TEMPORAL_ADVANCE', temporal_advanced: true });
    expect(service.onCaseTransitionCommitted).toHaveBeenCalledWith(
      ctx(fixture.workload.actor_id),
      expect.objectContaining({
        phase: 'DOMAIN_COMMITTED',
        domain_committed: true,
        temporal_advanced: false,
        command_type: 'MARK_RECEIVED',
        command_id: p.commandId,
      }),
      OUTBOX,
    );
  });

  it('starts a missing instance (SF-SYS-002) on the pinned version and retries once', async () => {
    let n = 0;
    const service = fakeService({
      onCaseTransitionCommitted: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Cmp016Error('SF-SYS-002');
        return { temporal_advanced: true as const, signal_id: APP };
      }),
    });
    const { p, receipt } = committedPipeline();
    expect(await new WorkflowAdvanceGate(bridgeOver(service)).advance(p, receipt, signal)).toBe(
      'SIGNALLED',
    );
    expect(service.startInstance).toHaveBeenCalledWith(ctx(fixture.workload.actor_id), {
      application_id: APP,
      workflow_version_id: PIN.workflow_version_id,
    });
    expect(service.onCaseTransitionCommitted).toHaveBeenCalledTimes(2);
  });

  it('any CMP-016/Temporal/OPA failure is DEFERRED_TO_OUTBOX and temporal_advanced stays false', async () => {
    for (const err of [
      new Cmp016Error('SF-SYS-004', [{ code: 'TEMPORAL_UNAVAILABLE' }]),
      new Cmp016Error('SF-AUTH-001'),
      new Cmp016Error('SF-WF-001', [{ code: 'PINNED_VERSION_MISMATCH' }]),
      new Error('socket hang up'),
    ]) {
      const service = fakeService({
        onCaseTransitionCommitted: vi.fn(async () => Promise.reject(err)),
      });
      const { p, receipt } = committedPipeline();
      expect(await new WorkflowAdvanceGate(bridgeOver(service)).advance(p, receipt, signal)).toBe(
        'DEFERRED_TO_OUTBOX',
      );
      expect(p.record()).toMatchObject({ phase: 'DOMAIN_COMMITTED', temporal_advanced: false });
    }
  });

  it('NEGATIVE: never reached before the CMP-015 commit', async () => {
    const service = fakeService();
    const p = new CommandPipeline({
      tenantId: TENANT,
      applicationId: APP,
      commandType: 'MARK_RECEIVED',
      idempotencyKey: 'cmd-000002',
      correlationId: CORR,
    });
    p.authorized('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'm10-b2c');
    p.validated('SUBMITTED', parsePinGraph(binding.pins));
    p.domainTxnOpened();
    const forged = Object.freeze({ tenantId: TENANT, applicationId: APP, aggregateVersion: 5 });
    await expect(
      new WorkflowAdvanceGate(bridgeOver(service)).advance(p, forged as never, signal),
    ).rejects.toMatchObject({ code: 'SF-WF-001' });
    expect(service.onCaseTransitionCommitted).not.toHaveBeenCalled();
  });

  it('draft hook: an existing instance is fine and a failure never fails the draft', async () => {
    const draft = {
      tenant_id: TENANT,
      application_id: APP,
      workflow_version_id: PIN.workflow_version_id,
      correlation_id: CORR,
    };
    const exists = fakeService({
      startInstance: vi.fn(async () => Promise.reject(new Cmp016Error('SF-APP-002'))),
    });
    expect(await bridgeOver(exists).onDraftCreated(draft)).toBe('STARTED');
    const down = fakeService({
      startInstance: vi.fn(async () =>
        Promise.reject(new Cmp016Error('SF-SYS-004', [{ code: 'TEMPORAL_UNAVAILABLE' }])),
      ),
    });
    expect(await bridgeOver(down).onDraftCreated(draft)).toBe('DEFERRED');
  });
});

describe('composeLabWorkflow', () => {
  const sdk: Cmp016SdkModule = {
    connectTemporalClient: vi.fn(),
    connectCanonicalWorker: vi.fn(),
    createCanonicalActivities: vi.fn(),
  };
  const base = {
    environment: 'LOCAL',
    cmp016,
    sdk,
    pool: {},
    pdp: { decide: vi.fn() },
    fixture,
    pins: [PIN],
    cellId: 'cell-lab-1',
    temporal: { address: '127.0.0.1:1', namespace: 'default', taskQueue: 'sf-sample-lab-workflow' },
  };

  it('connects nothing at build time; before start() every advance defers to the outbox', async () => {
    const wf = composeLabWorkflow(base);
    expect(sdk.connectTemporalClient).not.toHaveBeenCalled();
    const { p, receipt } = committedPipeline();
    expect(await new WorkflowAdvanceGate(wf.bridge).advance(p, receipt, signal)).toBe(
      'DEFERRED_TO_OUTBOX',
    );
    await expect(wf.readinessChecks[0]!.check()).rejects.toThrow(/worker not running/);
    await wf.close();
  });

  it('refuses a fixture whose graph no longer matches its recorded hash, and non-lab environments', () => {
    const tampered = structuredClone(fixture);
    (tampered.workflows[0]!.graph as { edges: { outcome?: string }[] }).edges[1]!.outcome =
      'RETURN_TO_DRAFT';
    expect(() => composeLabWorkflow({ ...base, fixture: tampered })).toThrow(/graph_hash mismatch/);
    expect(() => composeLabWorkflow({ ...base, environment: 'PRODUCTION' })).toThrow(/refused/);
  });
});

describe('nameUuid', () => {
  it('is a deterministic RFC 9562 v5 UUID scoped by tenant', () => {
    const a = nameUuid(TENANT, 'k');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nameUuid(TENANT, 'k')).toBe(a);
    expect(nameUuid('22222222-2222-4222-8222-222222222222', 'k')).not.toBe(a);
    // RFC 9562 Appendix A.4 example (DNS namespace, "www.example.com").
    expect(nameUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});
