import { describe, expect, it } from 'vitest';
import {
  Cmp016Error,
  activeNodes,
  applyCommitted,
  applyResult,
  applyTimerFired,
  atSafeBoundary,
  startInstance,
  toCanonicalModel,
  type CanonicalWorkflowModel,
  type Effect,
  type InstanceState,
  type WorkflowGraph,
} from '../../src/index.js';
import { ASSIGN, V1, V2, committed, linearGraph, model } from '../fixtures/models.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof Cmp016Error) return err.details[0]?.code;
    throw err;
  }
  return undefined;
}

function types(effects: Effect[]): string[] {
  return effects.map((e) => `${e.type}:${'node_id' in e ? e.node_id : ''}`);
}

/** Runs rich graph to the point where SCRUTINY waits and the SLA timer is armed. */
function atScrutiny(m: CanonicalWorkflowModel = model()): InstanceState {
  const s0 = startInstance(m);
  expect(types(s0.effects)).toEqual(['EVALUATE_RULE:ELIGIBILITY']);
  const s1 = applyResult(m, s0.state, {
    node_id: 'ELIGIBILITY',
    kind: 'RULE',
    outcome: 'ELIGIBLE',
  });
  expect(types(s1.effects)).toEqual(['CREATE_HUMAN_TASK:SCRUTINY', 'START_TIMER:SLA_TIMER']);
  expect(activeNodes(s1.state)).toEqual(['SCRUTINY', 'SLA_TIMER']);
  return s1.state;
}

describe('workflow interpreter: Temporal sequences, CMP-015 owns state', () => {
  it('starts deterministically and waits at a rule gate (CMP-008 port)', () => {
    const a = startInstance(model());
    const b = startInstance(model());
    expect(a).toEqual(b);
    expect(a.state.status).toBe('RUNNING');
    expect(a.effects[0]).toMatchObject({ type: 'EVALUATE_RULE', rule_ref: 'rules:eligibility:v1' });
  });

  it('human task assignment carries role + org + office + jurisdiction + scope, no principal', () => {
    const m = model();
    const s0 = startInstance(m);
    const s1 = applyResult(m, s0.state, {
      node_id: 'ELIGIBILITY',
      kind: 'RULE',
      outcome: 'ELIGIBLE',
    });
    const task = s1.effects.find((e) => e.type === 'CREATE_HUMAN_TASK');
    expect(task).toMatchObject({ assignment: ASSIGN });
    expect(Object.keys((task as { assignment: object }).assignment).sort()).toEqual([
      'claim_mode',
      'jurisdiction_id',
      'office_id',
      'organisation_id',
      'role_code',
      'service_scope_id',
    ]);
  });

  it('NEGATIVE: advance after a failed / uncommitted CMP-015 commit is rejected and state is unchanged', () => {
    const m = model();
    const s = atScrutiny(m);
    const before = structuredClone(s);
    for (const bad of [
      committed('COMPLETE_SCRUTINY', { domain_committed: false }),
      committed('COMPLETE_SCRUTINY', { phase: 'DOMAIN_TXN' }),
      committed('COMPLETE_SCRUTINY', { phase: 'CASE_MUTATED' }),
      committed('COMPLETE_SCRUTINY', { phase: 'OUTBOX_WRITTEN', domain_committed: true }),
    ]) {
      expect(code(() => applyCommitted(m, s, bad))).toBe('ADVANCE_BEFORE_DOMAIN_COMMIT');
    }
    expect(
      code(() => applyCommitted(m, s, committed('COMPLETE_SCRUTINY', { outbox_event_id: '' }))),
    ).toBe('ADVANCE_WITHOUT_OUTBOX');
    expect(
      code(() =>
        applyCommitted(
          m,
          s,
          committed('COMPLETE_SCRUTINY', { source_component: 'CMP-017' as never }),
        ),
      ),
    ).toBe('SIGNAL_SOURCE_NOT_AUTHORITATIVE');
    expect(s).toEqual(before);
  });

  it('NEGATIVE: signal pinned to another workflow version is rejected (no silent repoint)', () => {
    const m = model();
    const s = atScrutiny(m);
    expect(
      code(() => applyCommitted(m, s, committed('COMPLETE_SCRUTINY', { workflow_version_id: V2 }))),
    ).toBe('PINNED_VERSION_MISMATCH');
    const other = model(linearGraph(), V1);
    expect(code(() => applyCommitted(other, s, committed('APPROVE')))).toBe(
      'PINNED_VERSION_MISMATCH',
    );
  });

  it('rejects an outcome the pinned graph does not offer at an active node', () => {
    const m = model();
    const s = atScrutiny(m);
    expect(code(() => applyCommitted(m, s, committed('APPROVE')))).toBe('OUTCOME_NOT_EXPECTED');
    expect(
      code(() => applyCommitted(m, s, committed('COMPLETE_SCRUTINY', { node_id: 'SLA_TIMER' }))),
    ).toBe('OUTCOME_NOT_EXPECTED');
    expect(code(() => applyCommitted(m, s, committed('bad outcome')))).toBe('SIGNAL_FIELD_INVALID');
  });

  it('is idempotent on redelivered committed signals (at-least-once outbox)', () => {
    const m = model();
    const s = atScrutiny(m);
    const sig = committed('COMPLETE_SCRUTINY');
    const once = applyCommitted(m, s, sig);
    const twice = applyCommitted(m, once.state, sig);
    expect(twice.duplicate).toBe(true);
    expect(twice.effects).toEqual([]);
    expect(twice.state).toEqual(once.state);
  });

  it('parallel fork/join, timer and port nodes; completes only after both branches', () => {
    const m = model();
    const s = atScrutiny(m);
    const a = applyCommitted(m, s, committed('COMPLETE_SCRUTINY'));
    expect(types(a.effects)).toEqual(['CLOSE_HUMAN_TASK:SCRUTINY']);
    expect(a.state.joins).toEqual({ JOIN: 1 });
    expect(atSafeBoundary(a.state)).toBe(false);
    const b = applyTimerFired(m, a.state, 'SLA_TIMER');
    expect(types(b.effects)).toEqual(['INVOKE_PORT:ESCALATE']);
    const c = applyResult(m, b.state, { node_id: 'ESCALATE', kind: 'PORT' });
    expect(c.state.status).toBe('COMPLETED');
    expect(types(c.effects)).toEqual(['INSTANCE_COMPLETED:']);
    expect(code(() => applyCommitted(m, c.state, committed('COMPLETE_SCRUTINY')))).toBe(
      'INSTANCE_NOT_RUNNING',
    );
    expect(applyTimerFired(m, c.state, 'SLA_TIMER').effects).toEqual([]);
  });

  it('ignores a timer that is no longer armed', () => {
    const m = model();
    const s = atScrutiny(m);
    expect(applyTimerFired(m, s, 'SCRUTINY')).toEqual({ state: s, effects: [] });
  });

  it('rule gate routes on the deterministic rule outcome; unexpected results are rejected', () => {
    const m = model();
    const s0 = startInstance(m);
    expect(
      code(() =>
        applyResult(m, s0.state, { node_id: 'ELIGIBILITY', kind: 'RULE', outcome: 'MAYBE' }),
      ),
    ).toBe('OUTCOME_NOT_EXPECTED');
    expect(code(() => applyResult(m, s0.state, { node_id: 'SCRUTINY', kind: 'ACTIVITY' }))).toBe(
      'RESULT_NOT_EXPECTED',
    );
    const done = applyResult(m, s0.state, {
      node_id: 'ELIGIBILITY',
      kind: 'RULE',
      outcome: 'NOT_ELIGIBLE',
    });
    expect(done.state.status).toBe('COMPLETED');
  });

  it('withdrawal: request -> review (case unchanged) -> rejected review returns to scrutiny', () => {
    const m = model();
    const s = atScrutiny(m);
    const req = applyCommitted(
      m,
      s,
      committed('CITIZEN_WITHDRAW', { source_component: 'CMP-016' }),
    );
    expect(types(req.effects)).toEqual([
      'CLOSE_HUMAN_TASK:SCRUTINY',
      'CREATE_HUMAN_TASK:WITHDRAW_REV',
    ]);
    expect(activeNodes(req.state)).toEqual(['SLA_TIMER', 'WITHDRAW_REV']);
    const rejected = applyCommitted(m, req.state, committed('REJECT_WITHDRAWAL'));
    expect(types(rejected.effects)).toEqual([
      'CLOSE_HUMAN_TASK:WITHDRAW_REV',
      'CREATE_HUMAN_TASK:SCRUTINY',
    ]);
    expect(rejected.state.status).toBe('RUNNING');
  });

  it('withdrawal commit by CMP-015 terminates the instance and releases tasks and timers', () => {
    const m = model();
    const s = atScrutiny(m);
    const req = applyCommitted(
      m,
      s,
      committed('CITIZEN_WITHDRAW', { source_component: 'CMP-016' }),
    );
    const done = applyCommitted(m, req.state, committed('COMMIT_WITHDRAWAL'));
    expect(done.state.status).toBe('TERMINATED');
    expect(done.state.terminated_by).toBe('WITHDRAWAL_REVIEW');
    expect(done.state.tokens).toEqual([]);
    expect(types(done.effects)).toEqual([
      'CLOSE_HUMAN_TASK:WITHDRAW_REV',
      'CANCEL_TIMER:SLA_TIMER',
      'INSTANCE_TERMINATED:',
    ]);
  });

  it('cancellation review without assignment waits for a CMP-015 committed outcome', () => {
    const m = model();
    const s = atScrutiny(m);
    const req = applyCommitted(m, s, committed('ADMIN_CANCEL', { source_component: 'CMP-016' }));
    expect(types(req.effects)).toEqual(['CLOSE_HUMAN_TASK:SCRUTINY']);
    const done = applyCommitted(m, req.state, committed('COMMIT_CANCELLATION'));
    expect(done.state).toMatchObject({
      status: 'TERMINATED',
      terminated_by: 'CANCELLATION_REVIEW',
    });
  });

  it('decision routes on the committed outcome, with a default edge', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'REVIEW', kind: 'HUMAN_TASK', assignment: ASSIGN },
        { node_id: 'ROUTE', kind: 'DECISION' },
        { node_id: 'ISSUE_PORT', kind: 'ISSUE', port_only: true },
        { node_id: 'FIX', kind: 'DEFICIENCY' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'REVIEW' },
        { from_node: 'REVIEW', to_node: 'ROUTE', outcome: 'APPROVE' },
        { from_node: 'REVIEW', to_node: 'ROUTE', outcome: 'RAISE_DEFICIENCY' },
        { from_node: 'ROUTE', to_node: 'ISSUE_PORT', outcome: 'APPROVE' },
        { from_node: 'ROUTE', to_node: 'FIX', outcome: 'RAISE_DEFICIENCY' },
        { from_node: 'FIX', to_node: 'REVIEW' },
        { from_node: 'ISSUE_PORT', to_node: 'END' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s0 = startInstance(m);
    const fix = applyCommitted(m, s0.state, committed('RAISE_DEFICIENCY'));
    expect(types(fix.effects)).toEqual(['CLOSE_HUMAN_TASK:REVIEW', 'INVOKE_ACTIVITY:FIX']);
    const back = applyResult(m, fix.state, { node_id: 'FIX', kind: 'ACTIVITY' });
    expect(types(back.effects)).toEqual(['CREATE_HUMAN_TASK:REVIEW']);
    const issue = applyCommitted(m, back.state, committed('APPROVE'));
    expect(types(issue.effects)).toEqual(['CLOSE_HUMAN_TASK:REVIEW', 'INVOKE_PORT:ISSUE_PORT']);
    const end = applyResult(m, issue.state, {
      node_id: 'ISSUE_PORT',
      kind: 'PORT',
      outcome: 'ISSUED',
    });
    expect(end.state.status).toBe('COMPLETED');
  });

  it('faults deterministically when a decision has no matching edge', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'REVIEW', kind: 'WAIT' },
        { node_id: 'ROUTE', kind: 'DECISION' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'REVIEW' },
        { from_node: 'REVIEW', to_node: 'ROUTE', outcome: 'OTHER' },
        { from_node: 'ROUTE', to_node: 'END', outcome: 'APPROVE' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s = applyCommitted(m, startInstance(m).state, committed('OTHER'));
    expect(s.state).toMatchObject({ status: 'FAULTED', fault_code: 'CHOICE_NO_MATCHING_EDGE' });
  });

  it('decision with a rule ref evaluates through the rule port', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'ROUTE', kind: 'DECISION' },
        { node_id: 'CALL', kind: 'SERVICE_ACTIVITY' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'ROUTE' },
        {
          from_node: 'ROUTE',
          to_node: 'CALL',
          outcome: 'YES',
          condition_rule_ref: 'rules:route:v1',
        },
        { from_node: 'ROUTE', to_node: 'END', condition_rule_ref: 'rules:route:v1' },
        { from_node: 'CALL', to_node: 'END' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s0 = startInstance(m);
    expect(s0.effects).toEqual([
      { type: 'EVALUATE_RULE', node_id: 'ROUTE', token_id: 1, rule_ref: 'rules:route:v1' },
    ]);
    const s1 = applyResult(m, s0.state, { node_id: 'ROUTE', kind: 'RULE', outcome: 'NO' });
    expect(s1.state.status).toBe('COMPLETED');
  });

  it('faults when a join can no longer be satisfied', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'FORK', kind: 'PARALLEL' },
        { node_id: 'A', kind: 'WAIT' },
        { node_id: 'B', kind: 'WAIT' },
        { node_id: 'JOIN', kind: 'PARALLEL' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'FORK' },
        { from_node: 'FORK', to_node: 'A' },
        { from_node: 'FORK', to_node: 'B' },
        { from_node: 'A', to_node: 'JOIN', outcome: 'DONE' },
        { from_node: 'B', to_node: 'JOIN', outcome: 'DONE_B' },
        { from_node: 'B', to_node: 'END', outcome: 'SKIP' },
        { from_node: 'JOIN', to_node: 'END' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s0 = startInstance(m);
    const s1 = applyCommitted(m, s0.state, committed('DONE'));
    const s2 = applyCommitted(m, s1.state, committed('SKIP'));
    expect(s2.state).toMatchObject({ status: 'FAULTED', fault_code: 'JOIN_UNSATISFIABLE' });
  });

  it('a fork whose branch ends immediately still waits for sibling branches', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'FORK', kind: 'PARALLEL' },
        { node_id: 'A', kind: 'WAIT' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'FORK' },
        { from_node: 'FORK', to_node: 'END' },
        { from_node: 'FORK', to_node: 'A' },
        { from_node: 'A', to_node: 'END', outcome: 'DONE' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s0 = startInstance(m);
    expect(s0.state.status).toBe('RUNNING');
    expect(applyCommitted(m, s0.state, committed('DONE')).state.status).toBe('COMPLETED');
  });

  it('rejects ambiguous committed outcomes unless a node is named', () => {
    const g: WorkflowGraph = {
      nodes: [
        { node_id: 'START', kind: 'START' },
        { node_id: 'FORK', kind: 'PARALLEL' },
        { node_id: 'A', kind: 'WAIT' },
        { node_id: 'B', kind: 'WAIT' },
        { node_id: 'END', kind: 'END' },
      ],
      edges: [
        { from_node: 'START', to_node: 'FORK' },
        { from_node: 'FORK', to_node: 'A' },
        { from_node: 'FORK', to_node: 'B' },
        { from_node: 'A', to_node: 'END', outcome: 'DONE' },
        { from_node: 'B', to_node: 'END', outcome: 'DONE' },
      ],
    };
    const m = toCanonicalModel(V1, g);
    const s0 = startInstance(m);
    expect(code(() => applyCommitted(m, s0.state, committed('DONE')))).toBe('OUTCOME_AMBIGUOUS');
    const s1 = applyCommitted(m, s0.state, committed('DONE', { node_id: 'A' }));
    expect(activeNodes(s1.state)).toEqual(['B']);
  });

  it('safe boundary: only commit or timer waits, no partial joins', () => {
    const m = model();
    const s = atScrutiny(m);
    expect(atSafeBoundary(s)).toBe(true);
    expect(atSafeBoundary(startInstance(m).state)).toBe(false);
  });
});
