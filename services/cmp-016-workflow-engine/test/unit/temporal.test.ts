import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  TemporalSequencingAdapter,
  WORKFLOW_TYPE,
  assertExecutable,
  canonicalWorkflow,
  exportBpmn,
  importBpmn,
  newDraft,
  performEffect,
  publish,
  temporalWorkflowId,
  withTenantTx,
  type ExecutableVersion,
  type WorkflowStartInput,
} from '../../src/index.js';
import { InMemoryTemporalHost } from '../doubles/host.js';
import { FakeDb } from '../doubles/fake-db.js';
import { Ports, RecordingTemporal, ctx } from '../doubles/ports.js';
import {
  ACTOR,
  APP,
  CHECKER,
  T1,
  T2,
  V1,
  V2,
  committed,
  model,
  richGraph,
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

function executable(): ExecutableVersion {
  const d = newDraft({
    tenant_id: T1,
    definition_id: '44444444-4444-4444-8444-444444444444',
    version_id: V1,
    version_no: 1,
    origin: 'STUDIO',
    authored_by: ACTOR,
    graph: richGraph(),
  });
  return assertExecutable(
    publish(d, { approver_id: CHECKER, approval_ref: 'mc:1', at: '2026-10-05T00:00:00Z' }),
  );
}

function input(): WorkflowStartInput {
  const m = model();
  return {
    tenant_id: T1,
    cell_id: 'cell-local-1',
    application_id: APP,
    workflow_version_id: V1,
    graph_hash: m.graph_hash,
    model: m,
  };
}

describe('Temporal sequencing adapter: never authoritative case state', () => {
  it('exposes no operation that writes CMP-015 case state', () => {
    const methods = Object.getOwnPropertyNames(TemporalSequencingAdapter.prototype).sort();
    expect(methods).toEqual([
      'advance',
      'assertOutsideDomainTx',
      'constructor',
      'migrate',
      'start',
    ]);
    for (const m of methods)
      expect(m).not.toMatch(/case|state|status|transition|commit|update|write/i);
  });

  it('starts a published canonical version on Temporal with a deterministic workflow id', async () => {
    const client = new RecordingTemporal();
    const adapter = new TemporalSequencingAdapter(client, 'sf-workflow');
    const out = await adapter.start(ctx(), executable(), APP);
    expect(out.workflowId).toBe(temporalWorkflowId(T1, APP));
    const req = client.calls[0]?.payload as {
      workflowType: string;
      taskQueue: string;
      args: WorkflowStartInput[];
    };
    expect(req.workflowType).toBe(WORKFLOW_TYPE);
    expect(req.args[0]?.model.runtime).toBe('TEMPORAL');
    expect(req.args[0]?.workflow_version_id).toBe(V1);
  });

  it('NEGATIVE: imported BPMN cannot execute as an alternate runtime', async () => {
    const client = new RecordingTemporal();
    const adapter = new TemporalSequencingAdapter(client, 'sf-workflow');
    const xml = exportBpmn(model());
    const imported = importBpmn(xml);
    expect(await code(adapter.start(ctx(), xml as never, APP))).toBe('VERSION_NOT_EXECUTABLE');
    expect(await code(adapter.start(ctx(), imported as never, APP))).toBe('VERSION_NOT_EXECUTABLE');
    const forged = { ...executable() };
    expect(await code(adapter.start(ctx(), forged, APP))).toBe('VERSION_NOT_EXECUTABLE');
    const draft = newDraft({
      tenant_id: T1,
      definition_id: '44444444-4444-4444-8444-444444444444',
      version_id: V2,
      version_no: 2,
      origin: 'BPMN_IMPORT',
      authored_by: ACTOR,
      graph: imported.graph,
    });
    expect(() => assertExecutable(draft)).toThrow(Cmp016Error);
    expect(client.calls).toEqual([]);
  });

  it('NEGATIVE: refuses cross-tenant start/advance', async () => {
    const client = new RecordingTemporal();
    const adapter = new TemporalSequencingAdapter(client, 'sf-workflow');
    expect(await code(adapter.start(ctx({ tenant_id: T2 }), executable(), APP))).toBe('SF-TEN-002');
    expect(await code(adapter.advance(ctx({ tenant_id: T2 }), committed('X1')))).toBe('SF-TEN-002');
    expect(client.calls).toEqual([]);
  });

  it('NEGATIVE: advance before the domain commit is rejected and never reaches Temporal', async () => {
    const client = new RecordingTemporal();
    const adapter = new TemporalSequencingAdapter(client, 'sf-workflow');
    expect(await code(adapter.advance(ctx(), committed('X1', { domain_committed: false })))).toBe(
      'ADVANCE_BEFORE_DOMAIN_COMMIT',
    );
    expect(await code(adapter.advance(ctx(), committed('X1', { phase: 'OUTBOX_WRITTEN' })))).toBe(
      'ADVANCE_BEFORE_DOMAIN_COMMIT',
    );
    expect(client.calls).toEqual([]);
    await adapter.advance(ctx(), committed('X1'));
    expect(client.calls).toHaveLength(1);
  });

  it('NEGATIVE: no Temporal network call while an authoritative transaction is open', async () => {
    const log: string[] = [];
    const client = new RecordingTemporal(log);
    const adapter = new TemporalSequencingAdapter(client, 'sf-workflow');
    const db = new FakeDb(log);
    expect(await code(withTenantTx(db, ctx(), () => adapter.advance(ctx(), committed('X1'))))).toBe(
      'TEMPORAL_CALL_INSIDE_DOMAIN_TXN',
    );
    expect(await code(withTenantTx(db, ctx(), () => adapter.start(ctx(), executable(), APP)))).toBe(
      'TEMPORAL_CALL_INSIDE_DOMAIN_TXN',
    );
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK']);
    expect(client.calls).toEqual([]);
  });

  it('withTenantTx fails closed without tenant context', async () => {
    expect(await code(withTenantTx(new FakeDb(), ctx({ tenant_id: '' }), async () => 1))).toBe(
      'SF-TEN-001',
    );
  });
});

describe('canonical Temporal workflow body (deterministic host)', () => {
  it('runs the pinned graph end-to-end through ports, timers and committed signals', async () => {
    const ports = new Ports();
    const host = new InMemoryTemporalHost(ports, ctx());
    host.signals.push({
      type: 'COMMITTED',
      signal: committed('COMPLETE_SCRUTINY', { domain_committed: false }),
    });
    host.signals.push({ type: 'COMMITTED', signal: committed('COMPLETE_SCRUTINY') });
    const final = await canonicalWorkflow(host, input());
    expect(final.status).toBe('COMPLETED');
    expect(host.rejections).toEqual([
      {
        event: expect.objectContaining({ type: 'COMMITTED' }),
        code: 'ADVANCE_BEFORE_DOMAIN_COMMIT',
      },
    ]);
    expect(ports.log).toEqual([
      'rule:rules:eligibility:v1',
      `task.create:SCRUTINY:wf.${APP}.SCRUTINY.2.create`,
      'timer:SLA_TIMER',
      'task.close:SCRUTINY',
      'port:NOTIFY:ESCALATE',
    ]);
    expect(host.progressLog.at(-1)?.status).toBe('COMPLETED');
  });

  it('withdrawal commit terminates and cancels open work', async () => {
    const ports = new Ports();
    const host = new InMemoryTemporalHost(ports, ctx());
    host.signals.push({
      type: 'COMMITTED',
      signal: committed('CITIZEN_WITHDRAW', { source_component: 'CMP-016' }),
    });
    host.signals.push({ type: 'COMMITTED', signal: committed('COMMIT_WITHDRAWAL') });
    const final = await canonicalWorkflow(host, input());
    expect(final).toMatchObject({ status: 'TERMINATED', terminated_by: 'WITHDRAWAL_REVIEW' });
    expect(ports.log.filter((l) => l.startsWith('task.close'))).toEqual([
      'task.close:SCRUTINY',
      'task.close:WITHDRAW_REV',
    ]);
    expect(host.dispatched.some((e) => e.type === 'CANCEL_TIMER')).toBe(true);
  });

  it('applies an approved migration signal at a safe boundary and rejects a bad one', async () => {
    const ports = new Ports();
    const host = new InMemoryTemporalHost(ports, ctx());
    const g2 = richGraph();
    g2.edges = g2.edges.filter((e) => e.from_node !== 'ISSUE_PORT' && e.to_node !== 'ISSUE_PORT');
    g2.nodes = g2.nodes.filter((n) => n.node_id !== 'ISSUE_PORT');
    const to = model(g2, V2);
    const plan = {
      migration_id: '55555555-5555-4555-8555-555555555555',
      tenant_id: T1,
      from_version_id: V1,
      to_version_id: V2,
      node_mapping: { SCRUTINY: 'SCRUTINY', SLA_TIMER: 'SLA_TIMER' },
      approval_ref: 'mc:m:1',
      simulation_evidence_ref: 'evidence/sim/1',
      requested_by: ACTOR,
      approved_by: CHECKER,
    };
    host.signals.push({
      type: 'MIGRATE',
      migrate: { plan: { ...plan, approved_by: ACTOR }, target: { version_id: V2, model: to } },
    });
    host.signals.push({
      type: 'MIGRATE',
      migrate: { plan, target: { version_id: V2, model: to } },
    });
    host.signals.push({
      type: 'COMMITTED',
      signal: committed('COMPLETE_SCRUTINY', { workflow_version_id: V2 }),
    });
    const final = await canonicalWorkflow(host, input());
    expect(host.rejections.map((r) => r.code)).toEqual(['MAKER_CHECKER_SAME_PRINCIPAL']);
    expect(final.workflow_version_id).toBe(V2);
    expect(final.status).toBe('COMPLETED');
  });

  it('activity effects map only to sibling ports (no case-state effect exists)', async () => {
    const ports = new Ports();
    const i = input();
    expect(await performEffect(ports, ctx(), i, { type: 'INSTANCE_COMPLETED' })).toEqual({
      kind: 'NONE',
    });
    expect(
      await performEffect(ports, ctx(), i, {
        type: 'INVOKE_ACTIVITY',
        node_id: 'X',
        token_id: 1,
        kind: 'DEFICIENCY',
      }),
    ).toEqual({ kind: 'EVENT', event: { type: 'RESULT', node_id: 'X', kind: 'ACTIVITY' } });
    expect(
      await performEffect(ports, ctx(), i, { type: 'CANCEL_TIMER', node_id: 'T', token_id: 3 }),
    ).toEqual({
      kind: 'DISARM_TIMER',
      node_id: 'T',
      token_id: 3,
    });
  });
});
