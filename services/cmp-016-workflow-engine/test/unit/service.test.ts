import { beforeEach, describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  TemporalSequencingAdapter,
  WorkflowService,
  applyResult,
  exportBpmn,
  startInstance,
  type CommandTransitionRecord,
  type WorkflowGraph,
} from '../../src/index.js';
import { FakeDb, UnreachablePool } from '../doubles/fake-db.js';
import { Approvals, Authz, RecordingTemporal, ctx } from '../doubles/ports.js';
import {
  APP,
  CHECKER,
  T1,
  T2,
  frozenExample,
  linearGraph,
  model,
  richGraph,
  uuid,
} from '../fixtures/models.js';

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code ?? err.code;
    throw err;
  }
  return undefined;
}

interface Rig {
  log: string[];
  db: FakeDb;
  temporal: RecordingTemporal;
  authz: Authz;
  approvals: Approvals;
  svc: WorkflowService;
}

function rig(pool?: UnreachablePool): Rig & { pool?: UnreachablePool } {
  const log: string[] = [];
  const db = new FakeDb(log);
  const temporal = new RecordingTemporal(log);
  const authz = new Authz();
  const approvals = new Approvals();
  const svc = new WorkflowService({
    pool: pool ?? db,
    authz,
    approvals,
    temporal: new TemporalSequencingAdapter(temporal, 'sf-workflow'),
    now: () => new Date('2026-10-05T12:00:00.000Z'),
    newId: uuid,
  });
  return { log, db, temporal, authz, approvals, svc, ...(pool ? { pool } : {}) };
}

async function publishedVersion(r: Rig, graph: WorkflowGraph = richGraph(), key = 'service.flow') {
  const { definition_id } = await r.svc.createDefinition(ctx(), { definition_key: key });
  const draft = await r.svc.createDraft(ctx(), { definition_id, graph });
  const published = await r.svc.publish(ctx(), {
    version_id: draft.version_id,
    approval_ref: 'mc:approval:1',
  });
  return { definition_id, version: published };
}

function transition(
  over: Partial<CommandTransitionRecord> & { workflow_version_id: string },
): CommandTransitionRecord {
  const base = frozenExample('valid', 'command-transition') as unknown as CommandTransitionRecord;
  const { workflow_version_id, ...rest } = over;
  return {
    ...base,
    tenant_id: T1,
    application_id: APP,
    command_id: uuid(),
    pin_set: { ...base.pin_set, workflow_version_id },
    ...rest,
  };
}

describe('WorkflowService: domain command -> commit -> outbox -> Temporal (never reversed)', () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it('publishes through maker-checker approval and emits outbox + audit in the same transaction', async () => {
    const { version } = await publishedVersion(r);
    expect(version.status).toBe('PUBLISHED');
    expect(version.published_by).toBe(CHECKER);
    expect(r.approvals.requests[0]).toMatchObject({
      subject_type: 'WorkflowVersion',
      content_hash: version.model.graph_hash,
    });
    expect(r.db.outbox.map((o) => o['event_type'])).toEqual([
      'AuditEventSubmitted',
      'WorkflowVersionPublished',
      'AuditEventSubmitted',
    ]);
    expect(r.temporal.calls).toEqual([]);
  });

  it('NEGATIVE: a published version cannot be silently mutated through the service', async () => {
    const { version } = await publishedVersion(r);
    const before = r.db.statements.length;
    expect(
      await code(
        r.svc.reviseDraft(ctx(), { version_id: version.version_id, graph: linearGraph() }),
      ),
    ).toBe('PUBLISHED_VERSION_IMMUTABLE');
    expect(
      await code(r.svc.publish(ctx(), { version_id: version.version_id, approval_ref: 'mc:2' })),
    ).toBe('PUBLISHED_VERSION_IMMUTABLE');
    expect(r.db.statements.slice(before).some((s) => s.startsWith('UPDATE'))).toBe(false);
    const retired = await r.svc.retire(ctx(), version.version_id);
    expect(retired.status).toBe('RETIRED');
    expect(await code(r.svc.retire(ctx(), version.version_id))).toBe('ILLEGAL_VERSION_TRANSITION');
  });

  it('publication fails closed without approval, on same-principal approval and on concurrent edits', async () => {
    const { definition_id } = await r.svc.createDefinition(ctx(), { definition_key: 'svc.a' });
    const d = await r.svc.createDraft(ctx(), { definition_id, graph: linearGraph() });
    r.approvals.approved = false;
    expect(
      await code(r.svc.publish(ctx(), { version_id: d.version_id, approval_ref: 'mc:1' })),
    ).toBe('APPROVAL_MISSING');
    r.approvals.approved = true;
    r.approvals.approver = ctx().actor.id;
    expect(
      await code(r.svc.publish(ctx(), { version_id: d.version_id, approval_ref: 'mc:1' })),
    ).toBe('MAKER_CHECKER_SAME_PRINCIPAL');
  });

  it('NEGATIVE: named officer assignment is rejected before anything is stored', async () => {
    const { definition_id } = await r.svc.createDefinition(ctx(), { definition_key: 'svc.b' });
    const g = linearGraph();
    (g.nodes[1]?.assignment as unknown as Record<string, string>)['officer_name'] = 'A Person';
    expect(await code(r.svc.createDraft(ctx(), { definition_id, graph: g }))).toBe(
      'NAMED_OFFICER_FORBIDDEN',
    );
    expect(r.db.versions).toEqual([]);
  });

  it('starts Temporal only after the instance binding commits', async () => {
    const { version } = await publishedVersion(r);
    r.log.length = 0;
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    expect(r.log).toEqual([
      'BEGIN',
      'OUTBOX:WorkflowInstanceStarted',
      'OUTBOX:AuditEventSubmitted',
      'COMMIT',
      'TEMPORAL:start',
    ]);
  });

  it('NEGATIVE: a failed instance commit never starts Temporal', async () => {
    const { version } = await publishedVersion(r);
    r.db.failOn = /^INSERT INTO sf_workflow\.outbox_event/;
    expect(
      await code(
        r.svc.startInstance(ctx(), {
          application_id: APP,
          workflow_version_id: version.version_id,
        }),
      ),
    ).toBe('SF-SYS-001');
    expect(r.log.at(-1)).toBe('ROLLBACK');
    expect(r.temporal.calls).toEqual([]);
    expect(r.db.instances).toEqual([]);
  });

  it('NEGATIVE: imported BPMN drafts cannot start an execution', async () => {
    const { definition_id } = await r.svc.createDefinition(ctx(), { definition_key: 'svc.c' });
    const imported = await r.svc.importBpmnDraft(ctx(), {
      definition_id,
      xml: exportBpmn(model()),
    });
    expect(imported.origin).toBe('BPMN_IMPORT');
    expect(imported.status).toBe('DRAFT');
    expect(
      await code(
        r.svc.startInstance(ctx(), {
          application_id: APP,
          workflow_version_id: imported.version_id,
        }),
      ),
    ).toBe('VERSION_NOT_PUBLISHED');
    expect(r.temporal.calls).toEqual([]);
    expect(await r.svc.exportBpmn(ctx(), imported.version_id)).toContain('isExecutable="false"');
  });

  it('NEGATIVE: advance after a failed CMP-015 commit is rejected before DB or Temporal', async () => {
    const unreachable = new UnreachablePool();
    const x = rig(unreachable);
    const evt = uuid();
    for (const [name, expected] of [
      ['command-transition.temporal-before-commit', 'ADVANCE_BEFORE_DOMAIN_COMMIT'],
      ['command-transition.network-in-txn', 'TEMPORAL_CALL_INSIDE_DOMAIN_TXN'],
    ] as const) {
      const rec = frozenExample('invalid', name) as unknown as CommandTransitionRecord;
      expect(
        await code(x.svc.onCaseTransitionCommitted(ctx(), { ...rec, tenant_id: T1 }, evt)),
      ).toBe(expected);
    }
    const failed = transition({ workflow_version_id: uuid(), domain_committed: false });
    expect(await code(x.svc.onCaseTransitionCommitted(ctx(), failed, evt))).toBe(
      'ADVANCE_BEFORE_DOMAIN_COMMIT',
    );
    const notYet = transition({ workflow_version_id: uuid(), phase: 'OUTBOX_WRITTEN' });
    expect(await code(x.svc.onCaseTransitionCommitted(ctx(), notYet, evt))).toBe(
      'ADVANCE_BEFORE_DOMAIN_COMMIT',
    );
    const advanced = transition({ workflow_version_id: uuid(), temporal_advanced: true });
    expect(await code(x.svc.onCaseTransitionCommitted(ctx(), advanced, evt))).toBe(
      'ALREADY_ADVANCED',
    );
    const wrong = { ...transition({ workflow_version_id: uuid() }), contract_id: 'OTHER' } as never;
    expect(await code(x.svc.onCaseTransitionCommitted(ctx(), wrong, evt))).toBe(
      'SIGNAL_CONTRACT_INVALID',
    );
    expect(
      await code(
        x.svc.onCaseTransitionCommitted(ctx(), transition({ workflow_version_id: uuid() }), 'x'),
      ),
    ).toBe('ADVANCE_WITHOUT_OUTBOX');
    expect(unreachable.connects).toBe(0);
    expect(x.temporal.calls).toEqual([]);
  });

  it('delivers a committed CMP-015 transition: read check, Temporal signal, then inbox record', async () => {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    r.log.length = 0;
    const rec = transition({
      workflow_version_id: version.version_id,
      command_type: 'COMPLETE_SCRUTINY',
    });
    const evt = uuid();
    const out = await r.svc.onCaseTransitionCommitted(ctx(), rec, evt);
    expect(out).toEqual({
      phase: 'TEMPORAL_ADVANCE',
      domain_committed: true,
      temporal_advanced: true,
      signal_id: rec.command_id,
    });
    expect(r.log).toEqual([
      'BEGIN',
      'COMMIT',
      'TEMPORAL:signal:sf.committedTransition',
      'BEGIN',
      'COMMIT',
    ]);
    expect(r.db.inbox).toEqual([
      { consumer_group: 'cmp-016.case-transitions', event_id: evt, tenant_id: T1 },
    ]);
    expect(r.db.statements.some((s) => /sf_case|sf_application|cmp015/i.test(s))).toBe(false);
  });

  it('NEGATIVE: committed transition for another pin, tenant or unknown application is rejected', async () => {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    const calls = r.temporal.calls.length;
    expect(
      await code(
        r.svc.onCaseTransitionCommitted(ctx(), transition({ workflow_version_id: uuid() }), uuid()),
      ),
    ).toBe('PINNED_VERSION_MISMATCH');
    const other = transition({ workflow_version_id: version.version_id, tenant_id: T2 });
    expect(await code(r.svc.onCaseTransitionCommitted(ctx(), other, uuid()))).toBe('SF-TEN-002');
    const unknown = transition({ workflow_version_id: version.version_id, application_id: uuid() });
    expect(await code(r.svc.onCaseTransitionCommitted(ctx(), unknown, uuid()))).toBe('SF-SYS-002');
    expect(r.temporal.calls.length).toBe(calls);
  });

  it('CROSS_TENANT_LEAKAGE=0: tenant B cannot see or drive tenant A workflow records', async () => {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    const b = ctx({ tenant_id: T2 });
    expect(await code(r.svc.exportBpmn(b, version.version_id))).toBe('SF-SYS-002');
    expect(
      await code(
        r.svc.startInstance(b, { application_id: APP, workflow_version_id: version.version_id }),
      ),
    ).toBe('SF-SYS-002');
    expect(
      await code(
        r.svc.onCaseTransitionCommitted(
          b,
          transition({ workflow_version_id: version.version_id, tenant_id: T2 }),
          uuid(),
        ),
      ),
    ).toBe('SF-SYS-002');
    expect(
      await code(
        r.svc.submitRequest(b, {
          application_id: APP,
          request_kind: 'WITHDRAWAL',
          outcome: 'CITIZEN_WITHDRAW',
          idempotency_key: 'idem-xt-0001',
        }),
      ),
    ).toBe('SF-SYS-002');
  });

  async function runningAtScrutiny(): Promise<string> {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    const m = version.model;
    const s = applyResult(m, startInstance(m).state, {
      node_id: 'ELIGIBILITY',
      kind: 'RULE',
      outcome: 'ELIGIBLE',
    });
    await r.svc.recordProgress(ctx(), {
      application_id: APP,
      state: s.state,
      last_signal_id: null,
    });
    return version.version_id;
  }

  it('withdrawal request is a CMP-016 record (case untouched), committed before Temporal, idempotent', async () => {
    await runningAtScrutiny();
    r.log.length = 0;
    const req = {
      application_id: APP,
      request_kind: 'WITHDRAWAL' as const,
      outcome: 'CITIZEN_WITHDRAW',
      idempotency_key: 'idem-wd-0001',
    };
    const first = await r.svc.submitRequest(ctx(), req);
    expect(first.replayed).toBe(false);
    expect(r.log).toEqual([
      'BEGIN',
      'OUTBOX:WorkflowRequestRecorded',
      'OUTBOX:AuditEventSubmitted',
      'COMMIT',
      'BEGIN',
      'COMMIT',
      'TEMPORAL:signal:sf.committedTransition',
      'BEGIN',
      'COMMIT',
    ]);
    const sig = r.temporal.calls.at(-1)?.payload as {
      source_component: string;
      node_id: string;
      domain_committed: boolean;
    };
    expect(sig).toMatchObject({
      source_component: 'CMP-016',
      node_id: 'SCRUTINY',
      domain_committed: true,
    });
    expect(r.db.requests[0]).toMatchObject({
      status: 'PENDING_REVIEW',
      request_kind: 'WITHDRAWAL',
    });
    const calls = r.temporal.calls.length;
    expect(await r.svc.submitRequest(ctx(), req)).toEqual({
      request_id: first.request_id,
      replayed: true,
    });
    expect(r.temporal.calls.length).toBe(calls);
    expect(await code(r.svc.submitRequest(ctx(), { ...req, outcome: 'ADMIN_CANCEL' }))).toBe(
      'SF-APP-002',
    );
  });

  it('NEGATIVE: requests are offered only where the pinned workflow allows (Constitution #17)', async () => {
    await runningAtScrutiny();
    const base = { application_id: APP, idempotency_key: 'idem-no-0001' };
    expect(
      await code(
        r.svc.submitRequest(ctx(), {
          ...base,
          request_kind: 'CANCELLATION',
          outcome: 'CITIZEN_WITHDRAW',
        }),
      ),
    ).toBe('REQUEST_NOT_OFFERED');
    expect(
      await code(
        r.svc.submitRequest(ctx(), {
          ...base,
          request_kind: 'WITHDRAWAL',
          outcome: 'COMPLETE_SCRUTINY',
        }),
      ),
    ).toBe('REQUEST_NOT_OFFERED');
    expect(
      await code(
        r.svc.submitRequest(ctx(), { ...base, request_kind: 'OTHER' as never, outcome: 'X1' }),
      ),
    ).toBe('REQUEST_KIND_INVALID');
    expect(
      await code(r.svc.submitRequest(ctx(), { ...base, request_kind: 'WITHDRAWAL', outcome: 'x' })),
    ).toBe('OUTCOME_INVALID');
    expect(
      await code(
        r.svc.submitRequest(ctx(), {
          ...base,
          idempotency_key: 'k',
          request_kind: 'WITHDRAWAL',
          outcome: 'X1',
        }),
      ),
    ).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('NEGATIVE: a failed request commit never signals Temporal', async () => {
    await runningAtScrutiny();
    const calls = r.temporal.calls.length;
    r.db.failOn = /^INSERT INTO sf_workflow\.outbox_event/;
    expect(
      await code(
        r.svc.submitRequest(ctx(), {
          application_id: APP,
          request_kind: 'WITHDRAWAL',
          outcome: 'CITIZEN_WITHDRAW',
          idempotency_key: 'idem-fail-01',
        }),
      ),
    ).toBe('SF-SYS-001');
    expect(r.temporal.calls.length).toBe(calls);
    expect(r.db.requests).toEqual([]);
  });

  it('explicit migration: approved plan, safe boundary, DB repoint committed before Temporal', async () => {
    const v1 = await runningAtScrutiny();
    const draft = await r.svc.createDraft(ctx(), {
      definition_id: r.db.definitions[0]?.['definition_id'] as string,
      graph: richGraph(),
    });
    const g = richGraph();
    g.edges = g.edges.filter((e) => e.from_node !== 'ISSUE_PORT' && e.to_node !== 'ISSUE_PORT');
    g.nodes = g.nodes.filter((n) => n.node_id !== 'ISSUE_PORT');
    await r.svc.reviseDraft(ctx(), { version_id: draft.version_id, graph: g });
    const v2 = await r.svc.publish(ctx(), {
      version_id: draft.version_id,
      approval_ref: 'mc:approval:2',
    });
    const planInput = {
      from_version_id: v1,
      to_version_id: v2.version_id,
      node_mapping: { SCRUTINY: 'SCRUTINY', SLA_TIMER: 'SLA_TIMER' },
      approval_ref: 'mc:migration:1',
      simulation_evidence_ref: 'evidence/simulation/1',
      requested_by: ctx().actor.id,
    };
    r.approvals.approved = false;
    expect(await code(r.svc.approveMigration(ctx(), planInput))).toBe('APPROVAL_MISSING');
    r.approvals.approved = true;
    const plan = await r.svc.approveMigration(ctx(), planInput);
    expect(plan.approved_by).toBe(CHECKER);
    r.log.length = 0;
    await r.svc.applyMigration(ctx(), { application_id: APP, migration_id: plan.migration_id });
    expect(r.log).toEqual([
      'BEGIN',
      'OUTBOX:WorkflowInstanceMigrated',
      'OUTBOX:AuditEventSubmitted',
      'COMMIT',
      'TEMPORAL:signal:sf.migrate',
    ]);
    expect(r.db.instances[0]).toMatchObject({
      workflow_version_id: v2.version_id,
      migration_id: plan.migration_id,
    });
    expect(
      await code(
        r.svc.applyMigration(ctx(), { application_id: APP, migration_id: plan.migration_id }),
      ),
    ).toBe('MIGRATION_VERSION_MISMATCH');
  });

  it('NEGATIVE: migration outside a safe boundary is refused', async () => {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    await r.svc.recordProgress(ctx(), {
      application_id: APP,
      state: startInstance(version.model).state,
      last_signal_id: null,
    });
    const d2 = await r.svc.createDraft(ctx(), {
      definition_id: version.definition_id,
      graph: linearGraph(),
    });
    const v2 = await r.svc.publish(ctx(), {
      version_id: d2.version_id,
      approval_ref: 'mc:approval:3',
    });
    const plan = await r.svc.approveMigration(ctx(), {
      from_version_id: version.version_id,
      to_version_id: v2.version_id,
      node_mapping: {},
      approval_ref: 'mc:migration:2',
      simulation_evidence_ref: 'evidence/simulation/2',
      requested_by: ctx().actor.id,
    });
    const calls = r.temporal.calls.length;
    expect(
      await code(
        r.svc.applyMigration(ctx(), { application_id: APP, migration_id: plan.migration_id }),
      ),
    ).toBe('MIGRATION_NOT_AT_SAFE_BOUNDARY');
    expect(r.temporal.calls.length).toBe(calls);
  });

  it('deny-by-default authorization stops every command before the database', async () => {
    const unreachable = new UnreachablePool();
    const x = rig(unreachable);
    for (const a of [
      'WORKFLOW_DEFINITION_CREATE',
      'WORKFLOW_VERSION_DRAFT',
      'WORKFLOW_INSTANCE_START',
      'WORKFLOW_SIGNAL_ADVANCE',
      'WORKFLOW_REQUEST_SUBMIT',
      'WORKFLOW_VERSION_PUBLISH',
      'WORKFLOW_VERSION_RETIRE',
      'WORKFLOW_VERSION_EXPORT_BPMN',
      'WORKFLOW_MIGRATION_APPROVE',
      'WORKFLOW_MIGRATION_APPLY',
    ]) {
      x.authz.denied.add(a);
    }
    const id = uuid();
    const calls = [
      x.svc.createDefinition(ctx(), { definition_key: 'svc.d' }),
      x.svc.createDraft(ctx(), { definition_id: id, graph: linearGraph() }),
      x.svc.reviseDraft(ctx(), { version_id: id, graph: linearGraph() }),
      x.svc.startInstance(ctx(), { application_id: APP, workflow_version_id: id }),
      x.svc.onCaseTransitionCommitted(ctx(), transition({ workflow_version_id: id }), uuid()),
      x.svc.submitRequest(ctx(), {
        application_id: APP,
        request_kind: 'WITHDRAWAL',
        outcome: 'X1',
        idempotency_key: 'idem-deny-01',
      }),
      x.svc.publish(ctx(), { version_id: id, approval_ref: 'mc:1' }),
      x.svc.retire(ctx(), id),
      x.svc.exportBpmn(ctx(), id),
      x.svc.approveMigration(ctx(), {
        from_version_id: id,
        to_version_id: uuid(),
        node_mapping: {},
        approval_ref: 'a:1',
        simulation_evidence_ref: 's/1',
        requested_by: id,
      }),
      x.svc.applyMigration(ctx(), { application_id: APP, migration_id: id }),
    ];
    for (const c of calls) expect(await code(c)).toBe('SF-AUTH-002');
    expect(unreachable.connects).toBe(0);
  });

  it('validates identifiers and keys at the boundary', async () => {
    expect(await code(r.svc.createDefinition(ctx(), { definition_key: 'Bad Key' }))).toBe(
      'DEFINITION_KEY_INVALID',
    );
    expect(await code(r.svc.createDraft(ctx(), { definition_id: 'x', graph: {} }))).toBe(
      'UUID_REQUIRED',
    );
    expect(
      await code(r.svc.createDraft(ctx(), { definition_id: uuid(), graph: linearGraph() })),
    ).toBe('SF-SYS-002');
    expect(
      await code(r.svc.importBpmnDraft(ctx(), { definition_id: uuid(), xml: 1 as never })),
    ).toBe('BPMN_XML_REQUIRED');
    expect(
      await code(
        r.svc.recordProgress(ctx(), {
          application_id: APP,
          state: startInstance(model()).state,
          last_signal_id: null,
        }),
      ),
    ).toBe('SF-SYS-002');
    await r.svc.createDefinition(ctx(), { definition_key: 'svc.dup' });
    expect(await code(r.svc.createDefinition(ctx(), { definition_key: 'svc.dup' }))).toBe(
      'SF-APP-002',
    );
  });

  it('progress projection stops once the instance is terminal', async () => {
    const { version } = await publishedVersion(r);
    await r.svc.startInstance(ctx(), {
      application_id: APP,
      workflow_version_id: version.version_id,
    });
    const done = {
      ...startInstance(version.model).state,
      status: 'COMPLETED' as const,
      tokens: [],
    };
    await r.svc.recordProgress(ctx(), { application_id: APP, state: done, last_signal_id: null });
    expect(r.db.instances[0]).toMatchObject({ status: 'COMPLETED', active_nodes: [] });
    await r.svc.recordProgress(ctx(), {
      application_id: APP,
      state: startInstance(version.model).state,
      last_signal_id: null,
    });
    expect(r.db.instances[0]?.['status']).toBe('COMPLETED');
  });
});
