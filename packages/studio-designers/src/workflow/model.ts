/**
 * Studio workflow designer model over the canonical ServiceForm Workflow Model (FROZEN
 * SF-CON-WORKFLOW-MODEL, CMP-016). Positions and display labels are authoring layout only: they
 * never enter the hashed graph. Temporal stays the runtime; BPMN is import/export through CMP-016.
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

export const PORT_KINDS: readonly NodeKind[] = ['PAYMENT', 'SIGN', 'ISSUE', 'NOTIFY'];
export const CLAIM_MODES = ['CLAIM', 'PUSH', 'POOL'] as const;
export type ClaimMode = (typeof CLAIM_MODES)[number];

/** Role + organisation/office + jurisdiction + service scope; never a named officer (§19). */
export interface Assignment {
  role_code: string;
  organisation_id: string;
  office_id?: string;
  jurisdiction_id: string;
  service_scope_id?: string;
  claim_mode?: ClaimMode;
}

export interface CanonicalNode {
  node_id: string;
  kind: NodeKind;
  assignment?: Assignment;
  port_only?: boolean;
}

export interface CanonicalEdge {
  from_node: string;
  to_node: string;
  condition_rule_ref?: string;
  outcome?: string;
}

export interface CanonicalGraph {
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
}

export interface FlowNode {
  /** Canonical `node_id` (UPPER_SNAKE). */
  id: string;
  kind: NodeKind;
  /** Display label; authoring layout only. */
  label: string;
  x: number;
  y: number;
  assignment?: Assignment;
}

export interface FlowEdge {
  /** Editor identity; never emitted. */
  id: string;
  from: string;
  to: string;
  /** Committed command/outcome that takes this path (`APPROVE`, `SUBMIT`). */
  outcome?: string;
  /** GoRules decision reference evaluated at a routing node (`pack.key:decision`). */
  ruleRef?: string;
}

export interface WorkflowDesign {
  /** CMP-016 definition key. */
  key: string;
  title: string;
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_ID_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const RULE_REF_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const DEFINITION_KEY_RE = /^[a-z][a-z0-9._-]{1,127}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPort(kind: NodeKind): boolean {
  return PORT_KINDS.includes(kind);
}

export type KindGroup = 'events' | 'work' | 'routing' | 'ports' | 'requests';

export interface KindInfo {
  label: string;
  group: KindGroup;
  shape: 'circle' | 'rect' | 'diamond' | 'hexagon';
  description: string;
}

export const KIND_INFO: Record<NodeKind, KindInfo> = {
  START: {
    label: 'Start',
    group: 'events',
    shape: 'circle',
    description: 'Where every case begins.',
  },
  END: { label: 'End', group: 'events', shape: 'circle', description: 'A finished case.' },
  WAIT: {
    label: 'Wait for case step',
    group: 'events',
    shape: 'circle',
    description: 'Pause until CMP-015 commits the named transition.',
  },
  TIMER: {
    label: 'Timer',
    group: 'events',
    shape: 'circle',
    description: 'Pause for a duration set by SLA policy.',
  },
  HUMAN_TASK: {
    label: 'Officer task',
    group: 'work',
    shape: 'rect',
    description: 'Work for a role in an organisation and jurisdiction.',
  },
  SERVICE_ACTIVITY: {
    label: 'System activity',
    group: 'work',
    shape: 'rect',
    description: 'An automated step through a connector port.',
  },
  RULE_GATE: {
    label: 'Rule check',
    group: 'work',
    shape: 'rect',
    description: 'Routes on a deterministic GoRules decision.',
  },
  DEFICIENCY: {
    label: 'Deficiency',
    group: 'work',
    shape: 'rect',
    description: 'Ask the applicant to correct something.',
  },
  DECISION: {
    label: 'Choice',
    group: 'routing',
    shape: 'diamond',
    description: 'Take one path by committed outcome.',
  },
  PARALLEL: {
    label: 'Parallel split',
    group: 'routing',
    shape: 'diamond',
    description: 'Run every outgoing path.',
  },
  PAYMENT: {
    label: 'Payment',
    group: 'ports',
    shape: 'hexagon',
    description: 'Payment port (CMP-021).',
  },
  SIGN: { label: 'Sign', group: 'ports', shape: 'hexagon', description: 'eSign port.' },
  ISSUE: {
    label: 'Issue credential',
    group: 'ports',
    shape: 'hexagon',
    description: 'Credential issuance port (CMP-022).',
  },
  NOTIFY: {
    label: 'Notify',
    group: 'ports',
    shape: 'hexagon',
    description: 'Notification port (CMP-025).',
  },
  WITHDRAWAL_REQUEST: {
    label: 'Withdrawal request',
    group: 'requests',
    shape: 'rect',
    description: 'Applicant asks to withdraw; must go to a review.',
  },
  WITHDRAWAL_REVIEW: {
    label: 'Withdrawal review',
    group: 'requests',
    shape: 'rect',
    description: 'Officer reviews a withdrawal request.',
  },
  CANCELLATION_REQUEST: {
    label: 'Cancellation request',
    group: 'requests',
    shape: 'rect',
    description: 'Request to cancel; must go to a review.',
  },
  CANCELLATION_REVIEW: {
    label: 'Cancellation review',
    group: 'requests',
    shape: 'rect',
    description: 'Officer reviews a cancellation request.',
  },
};

export const NODE_SIZE: Record<KindInfo['shape'], { w: number; h: number }> = {
  circle: { w: 56, h: 56 },
  rect: { w: 168, h: 64 },
  diamond: { w: 80, h: 80 },
  hexagon: { w: 140, h: 56 },
};

export function sizeOf(kind: NodeKind): { w: number; h: number } {
  return NODE_SIZE[KIND_INFO[kind].shape];
}

export function outgoing(design: WorkflowDesign, id: string): FlowEdge[] {
  return design.edges.filter((e) => e.from === id);
}

export function incoming(design: WorkflowDesign, id: string): FlowEdge[] {
  return design.edges.filter((e) => e.to === id);
}
