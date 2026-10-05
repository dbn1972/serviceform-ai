import { invalid } from '../errors.js';
import { graphHash } from './hash.js';
import {
  CLAIM_MODES,
  CODE_RE,
  GRAPH_HASH_RE,
  NODE_ID_RE,
  NODE_KINDS,
  RULE_REF_RE,
  UUID_RE,
  incoming,
  isPortKind,
  isRequestKind,
  outgoing,
  type Assignment,
  type CanonicalWorkflowModel,
  type NodeKind,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from './model.js';

export const MAX_NODES = 500;
export const MAX_EDGES = 2000;

const ASSIGNMENT_KEYS = new Set([
  'role_code',
  'organisation_id',
  'office_id',
  'jurisdiction_id',
  'service_scope_id',
  'claim_mode',
]);
const NODE_KEYS = new Set(['node_id', 'kind', 'assignment', 'port_only']);
const EDGE_KEYS = new Set(['from_node', 'to_node', 'condition_rule_ref', 'outcome']);
const MODEL_KEYS = new Set([
  'contract_id',
  'contract_status',
  'freeze_status',
  'owner_component',
  'workflow_version_id',
  'graph_hash',
  'immutable',
  'runtime',
  'bpmn_role',
  'nodes',
  'edges',
]);

/** Field names that would bind work to an individual instead of role + org + jurisdiction + scope. */
const PERSONAL_ASSIGNEE =
  /officer|user|assignee|principal|employee|person|name|email|mobile|phone|login/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  pointer: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw invalid('UNKNOWN_FIELD', `${pointer}/${key}`);
  }
}

function parseAssignment(raw: unknown, pointer: string): Assignment {
  if (!isRecord(raw)) throw invalid('ASSIGNMENT_INVALID', pointer);
  for (const key of Object.keys(raw)) {
    if (!ASSIGNMENT_KEYS.has(key)) {
      throw invalid(
        PERSONAL_ASSIGNEE.test(key) ? 'NAMED_OFFICER_FORBIDDEN' : 'UNKNOWN_FIELD',
        `${pointer}/${key}`,
      );
    }
  }
  const { role_code, organisation_id, office_id, jurisdiction_id, service_scope_id, claim_mode } =
    raw;
  if (typeof role_code !== 'string' || !CODE_RE.test(role_code)) {
    throw invalid('ASSIGNMENT_ROLE_REQUIRED', `${pointer}/role_code`);
  }
  if (typeof organisation_id !== 'string' || !UUID_RE.test(organisation_id)) {
    throw invalid('ASSIGNMENT_ORGANISATION_REQUIRED', `${pointer}/organisation_id`);
  }
  if (typeof jurisdiction_id !== 'string' || !UUID_RE.test(jurisdiction_id)) {
    throw invalid('ASSIGNMENT_JURISDICTION_REQUIRED', `${pointer}/jurisdiction_id`);
  }
  const out: Assignment = { role_code, organisation_id, jurisdiction_id };
  if (office_id !== undefined) {
    if (typeof office_id !== 'string' || !UUID_RE.test(office_id)) {
      throw invalid('ASSIGNMENT_OFFICE_INVALID', `${pointer}/office_id`);
    }
    out.office_id = office_id;
  }
  if (service_scope_id !== undefined) {
    if (typeof service_scope_id !== 'string' || !UUID_RE.test(service_scope_id)) {
      throw invalid('ASSIGNMENT_SCOPE_INVALID', `${pointer}/service_scope_id`);
    }
    out.service_scope_id = service_scope_id;
  }
  if (claim_mode !== undefined) {
    if (!(CLAIM_MODES as readonly unknown[]).includes(claim_mode)) {
      throw invalid('ASSIGNMENT_CLAIM_MODE_INVALID', `${pointer}/claim_mode`);
    }
    out.claim_mode = claim_mode as Assignment['claim_mode'] & string;
  }
  return out;
}

function parseNode(raw: unknown, i: number): WorkflowNode {
  const pointer = `/nodes/${i}`;
  if (!isRecord(raw)) throw invalid('NODE_INVALID', pointer);
  if ('assignment' in raw && isRecord(raw['assignment'])) {
    // Personal-assignee keys are reported before generic unknown keys.
    parseAssignment(raw['assignment'], `${pointer}/assignment`);
  }
  rejectUnknownKeys(raw, NODE_KEYS, pointer);
  const { node_id, kind, assignment, port_only } = raw;
  if (typeof node_id !== 'string' || !NODE_ID_RE.test(node_id)) {
    throw invalid('NODE_ID_INVALID', `${pointer}/node_id`);
  }
  if (!(NODE_KINDS as readonly unknown[]).includes(kind)) {
    throw invalid('NODE_KIND_INVALID', `${pointer}/kind`);
  }
  const node: WorkflowNode = { node_id, kind: kind as NodeKind };
  if (assignment !== undefined)
    node.assignment = parseAssignment(assignment, `${pointer}/assignment`);
  if (port_only !== undefined) {
    if (typeof port_only !== 'boolean') throw invalid('PORT_ONLY_INVALID', `${pointer}/port_only`);
    node.port_only = port_only;
  }
  if (node.kind === 'HUMAN_TASK' && !node.assignment) {
    throw invalid('HUMAN_TASK_ASSIGNMENT_REQUIRED', `${pointer}/assignment`);
  }
  if (isPortKind(node.kind) && node.port_only !== true) {
    throw invalid('PORT_NODE_MUST_BE_PORT_ONLY', `${pointer}/port_only`);
  }
  if (!isPortKind(node.kind) && node.port_only === true) {
    throw invalid('PORT_ONLY_ON_NON_PORT_NODE', `${pointer}/port_only`);
  }
  return node;
}

function parseEdge(raw: unknown, i: number): WorkflowEdge {
  const pointer = `/edges/${i}`;
  if (!isRecord(raw)) throw invalid('EDGE_INVALID', pointer);
  rejectUnknownKeys(raw, EDGE_KEYS, pointer);
  const { from_node, to_node, condition_rule_ref, outcome } = raw;
  if (typeof from_node !== 'string' || !NODE_ID_RE.test(from_node)) {
    throw invalid('EDGE_FROM_INVALID', `${pointer}/from_node`);
  }
  if (typeof to_node !== 'string' || !NODE_ID_RE.test(to_node)) {
    throw invalid('EDGE_TO_INVALID', `${pointer}/to_node`);
  }
  const edge: WorkflowEdge = { from_node, to_node };
  if (condition_rule_ref !== undefined) {
    if (typeof condition_rule_ref !== 'string' || !RULE_REF_RE.test(condition_rule_ref)) {
      throw invalid('EDGE_RULE_REF_INVALID', `${pointer}/condition_rule_ref`);
    }
    edge.condition_rule_ref = condition_rule_ref;
  }
  if (outcome !== undefined) {
    if (typeof outcome !== 'string' || !CODE_RE.test(outcome)) {
      throw invalid('EDGE_OUTCOME_INVALID', `${pointer}/outcome`);
    }
    edge.outcome = outcome;
  }
  return edge;
}

function reachable(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const n of next(id)) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/** Rule ref evaluated at a routing node, or undefined when it routes on the committed outcome. */
export function routingRuleRef(graph: WorkflowGraph, nodeId: string): string | undefined {
  return outgoing(graph, nodeId).find((e) => e.condition_rule_ref)?.condition_rule_ref;
}

function checkSemantics(graph: WorkflowGraph): void {
  const byId = new Map<string, WorkflowNode>();
  graph.nodes.forEach((n, i) => {
    if (byId.has(n.node_id)) throw invalid('NODE_ID_DUPLICATE', `/nodes/${i}/node_id`);
    byId.set(n.node_id, n);
  });
  const starts = graph.nodes.filter((n) => n.kind === 'START');
  if (starts.length !== 1) throw invalid('EXACTLY_ONE_START_REQUIRED', '/nodes');
  if (!graph.nodes.some((n) => n.kind === 'END')) throw invalid('END_REQUIRED', '/nodes');

  const seenEdges = new Set<string>();
  graph.edges.forEach((e, i) => {
    if (!byId.has(e.from_node)) throw invalid('EDGE_UNKNOWN_NODE', `/edges/${i}/from_node`);
    if (!byId.has(e.to_node)) throw invalid('EDGE_UNKNOWN_NODE', `/edges/${i}/to_node`);
    if (e.from_node === e.to_node) throw invalid('EDGE_SELF_LOOP', `/edges/${i}`);
    const key = `${e.from_node}>${e.to_node}>${e.outcome ?? ''}>${e.condition_rule_ref ?? ''}`;
    if (seenEdges.has(key)) throw invalid('EDGE_DUPLICATE', `/edges/${i}`);
    seenEdges.add(key);
  });

  for (const node of graph.nodes) {
    const out = outgoing(graph, node.node_id);
    const pointer = `/nodes/${graph.nodes.indexOf(node)}`;
    if (node.kind === 'START') {
      if (incoming(graph, node.node_id).length > 0) throw invalid('START_HAS_INCOMING', pointer);
      if (out.length !== 1) throw invalid('START_SINGLE_OUTGOING', pointer);
    }
    if (node.kind === 'END') {
      if (out.length > 0) throw invalid('END_HAS_OUTGOING', pointer);
      continue;
    }
    if (out.length === 0) throw invalid('DEAD_END_NODE', pointer);
    if (node.kind === 'PARALLEL') {
      if (out.some((e) => e.outcome || e.condition_rule_ref)) {
        throw invalid('PARALLEL_EDGES_UNCONDITIONAL', pointer);
      }
      continue;
    }
    if (isRequestKind(node.kind)) {
      const review =
        node.kind === 'WITHDRAWAL_REQUEST' ? 'WITHDRAWAL_REVIEW' : 'CANCELLATION_REVIEW';
      if (out.length !== 1 || byId.get(out[0]?.to_node as string)?.kind !== review) {
        throw invalid('REQUEST_REQUIRES_REVIEW', pointer);
      }
    }
    const refs = new Set(out.map((e) => e.condition_rule_ref).filter(Boolean));
    if (refs.size > 1) throw invalid('ROUTING_RULE_REF_AMBIGUOUS', pointer);
    if (node.kind === 'RULE_GATE' && refs.size !== 1)
      throw invalid('RULE_GATE_RULE_REF_REQUIRED', pointer);
    if (out.length > 1) {
      const defaults = out.filter((e) => !e.outcome);
      if (defaults.length > 1) throw invalid('CHOICE_MULTIPLE_DEFAULTS', pointer);
      const outcomes = out.map((e) => e.outcome).filter(Boolean);
      if (new Set(outcomes).size !== outcomes.length)
        throw invalid('CHOICE_OUTCOME_DUPLICATE', pointer);
    }
  }

  const start = starts[0] as WorkflowNode;
  const forward = reachable(start.node_id, (id) => outgoing(graph, id).map((e) => e.to_node));
  for (const n of graph.nodes) {
    if (!forward.has(n.node_id))
      throw invalid('NODE_UNREACHABLE', `/nodes/${graph.nodes.indexOf(n)}`);
  }
  const canFinish = new Set<string>();
  for (const end of graph.nodes.filter((n) => n.kind === 'END')) {
    for (const id of reachable(end.node_id, (x) => incoming(graph, x).map((e) => e.from_node))) {
      canFinish.add(id);
    }
  }
  for (const n of graph.nodes) {
    if (!canFinish.has(n.node_id))
      throw invalid('NODE_CANNOT_REACH_END', `/nodes/${graph.nodes.indexOf(n)}`);
  }
}

/** Parses an untrusted graph (Studio draft or BPMN import) into a validated canonical graph. */
export function parseGraph(raw: unknown): WorkflowGraph {
  if (!isRecord(raw)) throw invalid('GRAPH_INVALID');
  const { nodes, edges } = raw;
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > MAX_NODES) {
    throw invalid('NODES_INVALID', '/nodes');
  }
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > MAX_EDGES) {
    throw invalid('EDGES_INVALID', '/edges');
  }
  const graph: WorkflowGraph = {
    nodes: nodes.map((n, i) => parseNode(n, i)),
    edges: edges.map((e, i) => parseEdge(e, i)),
  };
  checkSemantics(graph);
  return graph;
}

/** Validates a full SF-CON-WORKFLOW-MODEL artifact, including runtime/BPMN role and graph_hash. */
export function parseCanonicalModel(raw: unknown): CanonicalWorkflowModel {
  if (!isRecord(raw)) throw invalid('MODEL_INVALID');
  if (raw['runtime'] !== 'TEMPORAL') throw invalid('BPMN_RUNTIME_FORBIDDEN', '/runtime');
  if (raw['bpmn_role'] !== 'IMPORT_EXPORT_PROFILE_ONLY') {
    throw invalid('BPMN_RUNTIME_FORBIDDEN', '/bpmn_role');
  }
  const graph = parseGraph(raw);
  rejectUnknownKeys(raw, MODEL_KEYS, '');
  const constants: [string, unknown][] = [
    ['contract_id', 'SF-CON-WORKFLOW-MODEL'],
    ['contract_status', 'FROZEN'],
    ['freeze_status', 'FROZEN'],
    ['owner_component', 'CMP-016'],
    ['immutable', true],
  ];
  for (const [key, value] of constants) {
    if (raw[key] !== value) throw invalid('MODEL_CONSTANT_INVALID', `/${key}`);
  }
  const versionId = raw['workflow_version_id'];
  if (typeof versionId !== 'string' || !UUID_RE.test(versionId)) {
    throw invalid('WORKFLOW_VERSION_ID_INVALID', '/workflow_version_id');
  }
  const hash = raw['graph_hash'];
  if (typeof hash !== 'string' || !GRAPH_HASH_RE.test(hash)) {
    throw invalid('GRAPH_HASH_INVALID', '/graph_hash');
  }
  return {
    contract_id: 'SF-CON-WORKFLOW-MODEL',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    owner_component: 'CMP-016',
    workflow_version_id: versionId,
    graph_hash: hash,
    immutable: true,
    runtime: 'TEMPORAL',
    bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY',
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

/** A model is executable only when its graph_hash is the hash of its own graph. */
export function assertHashIntegrity(model: CanonicalWorkflowModel): void {
  if (graphHash(model) !== model.graph_hash) throw invalid('GRAPH_HASH_MISMATCH', '/graph_hash');
}

export function toCanonicalModel(versionId: string, graph: WorkflowGraph): CanonicalWorkflowModel {
  return {
    contract_id: 'SF-CON-WORKFLOW-MODEL',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    owner_component: 'CMP-016',
    workflow_version_id: versionId,
    graph_hash: graphHash(graph),
    immutable: true,
    runtime: 'TEMPORAL',
    bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY',
    nodes: graph.nodes,
    edges: graph.edges,
  };
}
