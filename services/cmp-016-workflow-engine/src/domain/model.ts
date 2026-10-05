/**
 * Canonical ServiceForm Workflow Model (FROZEN SF-CON-WORKFLOW-MODEL v1,
 * contracts/m05/schemas/workflow-model.schema.json). Temporal is the only runtime; BPMN is an
 * import/export profile over this graph (Constitution #33).
 */
export const NODE_KINDS = [
  'START',
  'HUMAN_TASK',
  'RULE_GATE',
  'SERVICE_ACTIVITY',
  'PAYMENT',
  'WAIT',
  'TIMER',
  'DEFICIENCY',
  'DECISION',
  'PARALLEL',
  'SIGN',
  'ISSUE',
  'NOTIFY',
  'END',
  'WITHDRAWAL_REQUEST',
  'WITHDRAWAL_REVIEW',
  'CANCELLATION_REQUEST',
  'CANCELLATION_REVIEW',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PORT_NODE_KINDS = ['PAYMENT', 'SIGN', 'ISSUE', 'NOTIFY'] as const;
export type PortNodeKind = (typeof PORT_NODE_KINDS)[number];

export const REQUEST_NODE_KINDS = ['WITHDRAWAL_REQUEST', 'CANCELLATION_REQUEST'] as const;
export const REVIEW_NODE_KINDS = ['WITHDRAWAL_REVIEW', 'CANCELLATION_REVIEW'] as const;

export const CLAIM_MODES = ['CLAIM', 'PUSH', 'POOL'] as const;
export type ClaimMode = (typeof CLAIM_MODES)[number];

/** Role + organisation/office + jurisdiction + service scope. Never a named officer (#19). */
export interface Assignment {
  role_code: string;
  organisation_id: string;
  office_id?: string;
  jurisdiction_id: string;
  service_scope_id?: string;
  claim_mode?: ClaimMode;
}

export interface WorkflowNode {
  node_id: string;
  kind: NodeKind;
  assignment?: Assignment;
  port_only?: boolean;
}

export interface WorkflowEdge {
  from_node: string;
  to_node: string;
  condition_rule_ref?: string;
  outcome?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface CanonicalWorkflowModel extends WorkflowGraph {
  contract_id: 'SF-CON-WORKFLOW-MODEL';
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  owner_component: 'CMP-016';
  workflow_version_id: string;
  graph_hash: string;
  immutable: true;
  runtime: 'TEMPORAL';
  bpmn_role: 'IMPORT_EXPORT_PROFILE_ONLY';
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const NODE_ID_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const RULE_REF_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const GRAPH_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function isPortKind(kind: NodeKind): kind is PortNodeKind {
  return (PORT_NODE_KINDS as readonly string[]).includes(kind);
}

export function isRequestKind(kind: NodeKind): boolean {
  return (REQUEST_NODE_KINDS as readonly string[]).includes(kind);
}

export function isReviewKind(kind: NodeKind): boolean {
  return (REVIEW_NODE_KINDS as readonly string[]).includes(kind);
}

export function nodeIndex(graph: WorkflowGraph): Map<string, WorkflowNode> {
  return new Map(graph.nodes.map((n) => [n.node_id, n]));
}

export function outgoing(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((e) => e.from_node === nodeId);
}

export function incoming(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((e) => e.to_node === nodeId);
}
