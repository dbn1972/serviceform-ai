import { reject } from '../errors.js';
import {
  incoming,
  isPortKind,
  isReviewKind,
  nodeIndex,
  outgoing,
  type Assignment,
  type CanonicalWorkflowModel,
  type NodeKind,
  type PortNodeKind,
  type WorkflowEdge,
  type WorkflowNode,
} from './model.js';
import { assertCommitted, type CommittedSignal } from './signals.js';
import { routingRuleRef } from './validate.js';

/**
 * Deterministic interpreter of the canonical workflow graph. It runs inside the Temporal workflow
 * (no clock, randomness or I/O) and only emits effects; it never reads or writes case state.
 */

export type WaitKind = 'COMMIT' | 'RULE' | 'ACTIVITY' | 'PORT' | 'TIMER';
export type InstanceStatus = 'RUNNING' | 'COMPLETED' | 'TERMINATED' | 'FAULTED';

export interface Token {
  token_id: number;
  node_id: string;
  wait: WaitKind;
}

export interface InstanceState {
  workflow_version_id: string;
  graph_hash: string;
  status: InstanceStatus;
  tokens: Token[];
  joins: Record<string, number>;
  next_token_id: number;
  seen_signals: string[];
  terminated_by?: NodeKind;
  fault_code?: string;
}

export type Effect =
  | { type: 'CREATE_HUMAN_TASK'; node_id: string; token_id: number; assignment: Assignment }
  | { type: 'CLOSE_HUMAN_TASK'; node_id: string; token_id: number }
  | { type: 'EVALUATE_RULE'; node_id: string; token_id: number; rule_ref: string }
  | {
      type: 'INVOKE_ACTIVITY';
      node_id: string;
      token_id: number;
      kind: 'SERVICE_ACTIVITY' | 'DEFICIENCY';
    }
  | { type: 'INVOKE_PORT'; node_id: string; token_id: number; port: PortNodeKind }
  | { type: 'START_TIMER'; node_id: string; token_id: number }
  | { type: 'CANCEL_TIMER'; node_id: string; token_id: number }
  | { type: 'INSTANCE_COMPLETED' }
  | { type: 'INSTANCE_TERMINATED'; review_kind: NodeKind }
  | { type: 'INSTANCE_FAULTED'; node_id: string; fault_code: string };

export interface Step {
  state: InstanceState;
  effects: Effect[];
  duplicate?: boolean;
}

export type ResultKind = 'RULE' | 'ACTIVITY' | 'PORT';

const SEEN_SIGNAL_WINDOW = 256;

class Run {
  readonly state: InstanceState;
  readonly effects: Effect[] = [];
  private readonly byId: Map<string, WorkflowNode>;
  private reachedEnd = false;

  constructor(
    private readonly model: CanonicalWorkflowModel,
    state: InstanceState,
  ) {
    this.state = structuredClone(state);
    this.byId = nodeIndex(model);
  }

  node(id: string): WorkflowNode {
    const n = this.byId.get(id);
    if (!n) throw reject('NODE_UNKNOWN', `/nodes/${id}`);
    return n;
  }

  private newToken(nodeId: string, wait: WaitKind): Token {
    const t = { token_id: this.state.next_token_id, node_id: nodeId, wait };
    this.state.next_token_id += 1;
    return t;
  }

  private fault(nodeId: string, code: string): void {
    this.state.status = 'FAULTED';
    this.state.fault_code = code;
    this.effects.push({ type: 'INSTANCE_FAULTED', node_id: nodeId, fault_code: code });
    this.releaseAll();
  }

  /** Cancels every outstanding human task and timer (CMP-017 cancel-close; Temporal timers). */
  private releaseAll(): void {
    for (const t of this.state.tokens) this.leave(t);
    this.state.tokens = [];
    this.state.joins = {};
  }

  private leave(token: Token): void {
    const n = this.node(token.node_id);
    const ref = { node_id: n.node_id, token_id: token.token_id };
    if (n.assignment) this.effects.push({ type: 'CLOSE_HUMAN_TASK', ...ref });
    if (token.wait === 'TIMER') this.effects.push({ type: 'CANCEL_TIMER', ...ref });
  }

  /** Chooses the edge for an outcome: exact outcome match, else the single default edge. */
  pick(nodeId: string, outcome: string | undefined): WorkflowEdge | undefined {
    const out = outgoing(this.model, nodeId);
    if (outcome !== undefined) {
      const exact = out.find((e) => e.outcome === outcome);
      if (exact) return exact;
    }
    const defaults = out.filter((e) => !e.outcome);
    return defaults.length === 1 ? defaults[0] : undefined;
  }

  /** Moves a token out of its node along an edge, then enters the target. */
  traverse(token: Token, edge: WorkflowEdge): void {
    this.state.tokens = this.state.tokens.filter((t) => t.token_id !== token.token_id);
    this.leave(token);
    this.enter(edge.to_node, edge.outcome, this.node(token.node_id));
  }

  enter(nodeId: string, inboundOutcome: string | undefined, from?: WorkflowNode): void {
    if (this.state.status !== 'RUNNING') return;
    const n = this.node(nodeId);
    switch (n.kind) {
      case 'START': {
        const edge = outgoing(this.model, n.node_id)[0] as WorkflowEdge;
        this.enter(edge.to_node, edge.outcome, n);
        return;
      }
      case 'END': {
        if (from && isReviewKind(from.kind)) {
          this.state.terminated_by = from.kind;
          this.state.status = 'TERMINATED';
          this.releaseAll();
          this.effects.push({ type: 'INSTANCE_TERMINATED', review_kind: from.kind });
          return;
        }
        this.reachedEnd = true;
        return;
      }
      case 'PARALLEL': {
        const arity = incoming(this.model, n.node_id).length;
        if (arity > 1) {
          const arrived = (this.state.joins[n.node_id] ?? 0) + 1;
          if (arrived < arity) {
            this.state.joins[n.node_id] = arrived;
            return;
          }
          this.state.joins = Object.fromEntries(
            Object.entries(this.state.joins).filter(([id]) => id !== n.node_id),
          );
        }
        for (const edge of outgoing(this.model, n.node_id)) this.enter(edge.to_node, undefined, n);
        return;
      }
      case 'DECISION': {
        const ruleRef = routingRuleRef(this.model, n.node_id);
        if (ruleRef) {
          const t = this.wait(n, 'RULE');
          this.effects.push({
            type: 'EVALUATE_RULE',
            node_id: n.node_id,
            token_id: t,
            rule_ref: ruleRef,
          });
          return;
        }
        const edge = this.pick(n.node_id, inboundOutcome);
        if (!edge) {
          this.fault(n.node_id, 'CHOICE_NO_MATCHING_EDGE');
          return;
        }
        this.enter(edge.to_node, edge.outcome, n);
        return;
      }
      case 'RULE_GATE': {
        const t = this.wait(n, 'RULE');
        this.effects.push({
          type: 'EVALUATE_RULE',
          node_id: n.node_id,
          token_id: t,
          rule_ref: routingRuleRef(this.model, n.node_id) as string,
        });
        return;
      }
      case 'SERVICE_ACTIVITY':
      case 'DEFICIENCY': {
        const t = this.wait(n, 'ACTIVITY');
        this.effects.push({
          type: 'INVOKE_ACTIVITY',
          node_id: n.node_id,
          token_id: t,
          kind: n.kind,
        });
        return;
      }
      case 'TIMER': {
        const t = this.wait(n, 'TIMER');
        this.effects.push({ type: 'START_TIMER', node_id: n.node_id, token_id: t });
        return;
      }
      case 'WITHDRAWAL_REQUEST':
      case 'CANCELLATION_REQUEST': {
        // The request record was committed by CMP-016 before this signal; case state unchanged.
        const edge = outgoing(this.model, n.node_id)[0] as WorkflowEdge;
        this.enter(edge.to_node, edge.outcome, n);
        return;
      }
      default: {
        if (isPortKind(n.kind)) {
          const t = this.wait(n, 'PORT');
          this.effects.push({ type: 'INVOKE_PORT', node_id: n.node_id, token_id: t, port: n.kind });
          return;
        }
        // HUMAN_TASK, WAIT, WITHDRAWAL_REVIEW, CANCELLATION_REVIEW: wait for a committed outcome.
        const t = this.wait(n, 'COMMIT');
        if (n.assignment) {
          this.effects.push({
            type: 'CREATE_HUMAN_TASK',
            node_id: n.node_id,
            token_id: t,
            assignment: n.assignment,
          });
        }
      }
    }
  }

  private wait(n: WorkflowNode, wait: WaitKind): number {
    const token = this.newToken(n.node_id, wait);
    this.state.tokens.push(token);
    return token.token_id;
  }

  /** Completion is decided once all synchronous moves of this step (including forks) are done. */
  finish(): Step {
    if (this.state.status === 'RUNNING' && this.state.tokens.length === 0) {
      if (Object.keys(this.state.joins).length > 0) {
        this.fault(Object.keys(this.state.joins)[0] as string, 'JOIN_UNSATISFIABLE');
      } else if (this.reachedEnd) {
        this.state.status = 'COMPLETED';
        this.effects.push({ type: 'INSTANCE_COMPLETED' });
      }
    }
    return { state: this.state, effects: this.effects };
  }
}

function assertRunning(state: InstanceState): void {
  if (state.status !== 'RUNNING') throw reject('INSTANCE_NOT_RUNNING', '/status');
}

function assertSameModel(model: CanonicalWorkflowModel, state: InstanceState): void {
  if (
    model.workflow_version_id !== state.workflow_version_id ||
    model.graph_hash !== state.graph_hash
  ) {
    throw reject('PINNED_VERSION_MISMATCH', '/workflow_version_id');
  }
}

export function startInstance(model: CanonicalWorkflowModel): Step {
  const initial: InstanceState = {
    workflow_version_id: model.workflow_version_id,
    graph_hash: model.graph_hash,
    status: 'RUNNING',
    tokens: [],
    joins: {},
    next_token_id: 1,
    seen_signals: [],
  };
  const run = new Run(model, initial);
  const start = model.nodes.find((n) => n.kind === 'START') as WorkflowNode;
  run.enter(start.node_id, undefined);
  return run.finish();
}

/** Advances a commit-wait token on a committed domain outcome. Rejects everything else. */
export function applyCommitted(
  model: CanonicalWorkflowModel,
  state: InstanceState,
  signal: CommittedSignal,
): Step {
  assertCommitted(signal);
  assertSameModel(model, state);
  if (signal.workflow_version_id !== state.workflow_version_id) {
    throw reject('PINNED_VERSION_MISMATCH', '/workflow_version_id');
  }
  if (state.seen_signals.includes(signal.signal_id)) {
    return { state, effects: [], duplicate: true };
  }
  assertRunning(state);
  const run = new Run(model, state);
  const candidates = run.state.tokens.filter(
    (t) =>
      t.wait === 'COMMIT' &&
      (signal.node_id === undefined || t.node_id === signal.node_id) &&
      outgoing(model, t.node_id).some((e) => e.outcome === signal.outcome),
  );
  if (candidates.length === 0) throw reject('OUTCOME_NOT_EXPECTED', '/outcome');
  if (candidates.length > 1) throw reject('OUTCOME_AMBIGUOUS', '/node_id');
  const token = candidates[0] as Token;
  run.state.seen_signals = [...run.state.seen_signals, signal.signal_id].slice(-SEEN_SIGNAL_WINDOW);
  run.traverse(token, run.pick(token.node_id, signal.outcome) as WorkflowEdge);
  return run.finish();
}

/** Applies a rule/activity/port result produced by a Temporal activity (never case state). */
export function applyResult(
  model: CanonicalWorkflowModel,
  state: InstanceState,
  result: { node_id: string; kind: ResultKind; outcome?: string },
): Step {
  assertSameModel(model, state);
  assertRunning(state);
  const run = new Run(model, state);
  const token = run.state.tokens.find(
    (t) => t.node_id === result.node_id && t.wait === result.kind,
  );
  if (!token) throw reject('RESULT_NOT_EXPECTED', `/nodes/${result.node_id}`);
  const edge = run.pick(token.node_id, result.outcome);
  if (!edge) throw reject('OUTCOME_NOT_EXPECTED', '/outcome');
  run.traverse(token, edge);
  return run.finish();
}

export function applyTimerFired(
  model: CanonicalWorkflowModel,
  state: InstanceState,
  nodeId: string,
): Step {
  assertSameModel(model, state);
  if (state.status !== 'RUNNING') return { state, effects: [] };
  const run = new Run(model, state);
  const token = run.state.tokens.find((t) => t.node_id === nodeId && t.wait === 'TIMER');
  if (!token) return { state, effects: [] };
  const edge = run.pick(nodeId, undefined) as WorkflowEdge | undefined;
  if (!edge) throw reject('TIMER_EDGE_MISSING', `/nodes/${nodeId}`);
  run.state.tokens = run.state.tokens.filter((t) => t.token_id !== token.token_id);
  run.enter(edge.to_node, edge.outcome, run.node(nodeId));
  return run.finish();
}

/** Node ids where the instance currently waits (sequencing projection, not case state). */
export function activeNodes(state: InstanceState): string[] {
  return [...new Set(state.tokens.map((t) => t.node_id))].sort();
}

/**
 * Safe migration boundary: every token waits on a commit, timer or human task (no rule, activity
 * or port call in flight) and no parallel join is partially satisfied.
 */
export function atSafeBoundary(state: InstanceState): boolean {
  return (
    state.status === 'RUNNING' &&
    Object.keys(state.joins).length === 0 &&
    state.tokens.every((t) => t.wait === 'COMMIT' || t.wait === 'TIMER')
  );
}
