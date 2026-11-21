import type { Assignment, CanonicalGraph, CanonicalNode } from './model';

/**
 * Starting points for the workflow designer. The commit-wait graph is the SAMPLE_LAB case
 * sequencing graph that CMP-016 already runs on the platform host (fixtures/lab/platform/
 * workflow.json; a test keeps them identical). Every edge is a FROZEN application-case command;
 * Temporal only follows committed CMP-015 transitions and never decides them.
 *
 * SAMPLE_LAB multi-desk: WAIT_UNDER_SCRUTINY and WAIT_DECISION_PENDING are HUMAN_TASK nodes with
 * role_code + org + jurisdiction assignment (never named officers).
 */

const LAB_ORG = '0d15ba00-0a01-4000-8000-0d15ba000a01';
const LAB_JUR = '0d15ba00-0b01-4000-8000-0d15ba000b01';

const DESK_ASSIGNMENT: Record<string, Assignment> = {
  UNDER_SCRUTINY: {
    role_code: 'SAMPLE_LAB_SCRUTINY_OFFICER',
    organisation_id: LAB_ORG,
    jurisdiction_id: LAB_JUR,
    claim_mode: 'CLAIM',
  },
  DECISION_PENDING: {
    role_code: 'SAMPLE_LAB_APPROVING_AUTHORITY',
    organisation_id: LAB_ORG,
    jurisdiction_id: LAB_JUR,
    claim_mode: 'CLAIM',
  },
};

const WAITS = [
  'DRAFT',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'PAYMENT_PENDING',
  'RECEIVED',
  'UNDER_SCRUTINY',
  'DEFICIENCY_RAISED',
  'CITIZEN_RESPONSE',
  'VERIFICATION',
  'DECISION_PENDING',
  'APPROVED',
  'REJECTED',
  'SIGNING_PENDING',
  'ISSUED',
] as const;

const PATHS: [string, string, string?][] = [
  ['START', 'WAIT_DRAFT'],
  ['WAIT_DRAFT', 'WAIT_READY_TO_SUBMIT', 'MARK_READY_TO_SUBMIT'],
  ['WAIT_READY_TO_SUBMIT', 'WAIT_SUBMITTED', 'SUBMIT'],
  ['WAIT_READY_TO_SUBMIT', 'WAIT_DRAFT', 'RETURN_TO_DRAFT'],
  ['WAIT_SUBMITTED', 'WAIT_PAYMENT_PENDING', 'ENTER_PAYMENT_PENDING'],
  ['WAIT_SUBMITTED', 'WAIT_RECEIVED', 'MARK_RECEIVED'],
  ['WAIT_PAYMENT_PENDING', 'WAIT_RECEIVED', 'MARK_RECEIVED'],
  ['WAIT_RECEIVED', 'WAIT_UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['WAIT_UNDER_SCRUTINY', 'WAIT_DEFICIENCY_RAISED', 'RAISE_DEFICIENCY'],
  ['WAIT_UNDER_SCRUTINY', 'WAIT_VERIFICATION', 'ENTER_VERIFICATION'],
  ['WAIT_UNDER_SCRUTINY', 'WAIT_DECISION_PENDING', 'ENTER_DECISION_PENDING'],
  ['WAIT_DEFICIENCY_RAISED', 'WAIT_CITIZEN_RESPONSE', 'RECORD_CITIZEN_RESPONSE'],
  ['WAIT_CITIZEN_RESPONSE', 'WAIT_UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['WAIT_VERIFICATION', 'WAIT_UNDER_SCRUTINY', 'ENTER_SCRUTINY'],
  ['WAIT_VERIFICATION', 'WAIT_DECISION_PENDING', 'ENTER_DECISION_PENDING'],
  ['WAIT_DECISION_PENDING', 'WAIT_APPROVED', 'RECORD_APPROVED'],
  ['WAIT_DECISION_PENDING', 'WAIT_REJECTED', 'RECORD_REJECTED'],
  ['WAIT_APPROVED', 'WAIT_SIGNING_PENDING', 'ENTER_SIGNING_PENDING'],
  ['WAIT_APPROVED', 'WAIT_ISSUED', 'RECORD_ISSUED'],
  ['WAIT_REJECTED', 'END_CLOSED', 'CLOSE'],
  ['WAIT_SIGNING_PENDING', 'WAIT_ISSUED', 'RECORD_ISSUED'],
  ['WAIT_ISSUED', 'END_CLOSED', 'CLOSE'],
];

function waitNode(state: (typeof WAITS)[number]): CanonicalNode {
  const assignment = DESK_ASSIGNMENT[state];
  if (assignment) {
    return { node_id: `WAIT_${state}`, kind: 'HUMAN_TASK', assignment: { ...assignment } };
  }
  return { node_id: `WAIT_${state}`, kind: 'WAIT' };
}

export function caseSequencingGraph(): CanonicalGraph {
  return {
    nodes: [
      { node_id: 'START', kind: 'START' },
      ...WAITS.map(waitNode),
      { node_id: 'END_CLOSED', kind: 'END' },
    ],
    edges: PATHS.map(([from_node, to_node, outcome]) =>
      outcome ? { from_node, to_node, outcome } : { from_node, to_node },
    ),
  };
}

export interface WorkflowTemplate {
  id: string;
  title: string;
  key: string;
  description: string;
  graph: () => CanonicalGraph;
}

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'case-sequencing',
    title: 'Application case sequencing (commit-wait)',
    key: 'lab.ind-soc-002.case-flow',
    description:
      'The SAMPLE_LAB graph CMP-016 runs today: HUMAN_TASK desks by role_code, other waits per case state; edges are committed case commands.',
    graph: caseSequencingGraph,
  },
];
