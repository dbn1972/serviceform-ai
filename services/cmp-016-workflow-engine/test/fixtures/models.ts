import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toCanonicalModel,
  type Assignment,
  type CanonicalWorkflowModel,
  type CommittedSignal,
  type WorkflowGraph,
  type WorkflowStartInput,
} from '../../src/index.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const M05 = join(ROOT, 'contracts/m05');

export function frozenExample(kind: 'valid' | 'invalid', name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(M05, 'examples', kind, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const APP = '33333333-3333-4333-8333-333333333333';
export const V1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const V2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CHECKER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const ASSIGN: Assignment = {
  role_code: 'SCRUTINY_OFFICER',
  organisation_id: '66666666-6666-4666-8666-666666666666',
  office_id: '19191919-1919-4191-8191-191919191919',
  jurisdiction_id: '77777777-7777-4777-8777-777777777777',
  service_scope_id: '18181818-1818-4181-8181-181818181818',
  claim_mode: 'CLAIM',
};

/** Scrutiny with withdrawal / cancellation review, escalation timer in parallel, rule gate. */
export function richGraph(): WorkflowGraph {
  return {
    nodes: [
      { node_id: 'START', kind: 'START' },
      { node_id: 'ELIGIBILITY', kind: 'RULE_GATE' },
      { node_id: 'FORK', kind: 'PARALLEL' },
      { node_id: 'SCRUTINY', kind: 'HUMAN_TASK', assignment: { ...ASSIGN } },
      { node_id: 'SLA_TIMER', kind: 'TIMER' },
      { node_id: 'ESCALATE', kind: 'NOTIFY', port_only: true },
      { node_id: 'JOIN', kind: 'PARALLEL' },
      { node_id: 'ROUTE', kind: 'DECISION' },
      { node_id: 'ISSUE_PORT', kind: 'ISSUE', port_only: true },
      { node_id: 'WITHDRAW_REQ', kind: 'WITHDRAWAL_REQUEST' },
      { node_id: 'WITHDRAW_REV', kind: 'WITHDRAWAL_REVIEW', assignment: { ...ASSIGN } },
      { node_id: 'CANCEL_REQ', kind: 'CANCELLATION_REQUEST' },
      { node_id: 'CANCEL_REV', kind: 'CANCELLATION_REVIEW' },
      { node_id: 'END', kind: 'END' },
    ],
    edges: [
      { from_node: 'START', to_node: 'ELIGIBILITY' },
      {
        from_node: 'ELIGIBILITY',
        to_node: 'FORK',
        outcome: 'ELIGIBLE',
        condition_rule_ref: 'rules:eligibility:v1',
      },
      {
        from_node: 'ELIGIBILITY',
        to_node: 'END',
        outcome: 'NOT_ELIGIBLE',
        condition_rule_ref: 'rules:eligibility:v1',
      },
      { from_node: 'FORK', to_node: 'SCRUTINY' },
      { from_node: 'FORK', to_node: 'SLA_TIMER' },
      { from_node: 'SLA_TIMER', to_node: 'ESCALATE' },
      { from_node: 'ESCALATE', to_node: 'JOIN' },
      { from_node: 'SCRUTINY', to_node: 'JOIN', outcome: 'COMPLETE_SCRUTINY' },
      { from_node: 'SCRUTINY', to_node: 'WITHDRAW_REQ', outcome: 'CITIZEN_WITHDRAW' },
      { from_node: 'SCRUTINY', to_node: 'CANCEL_REQ', outcome: 'ADMIN_CANCEL' },
      { from_node: 'WITHDRAW_REQ', to_node: 'WITHDRAW_REV' },
      { from_node: 'WITHDRAW_REV', to_node: 'END', outcome: 'COMMIT_WITHDRAWAL' },
      { from_node: 'WITHDRAW_REV', to_node: 'SCRUTINY', outcome: 'REJECT_WITHDRAWAL' },
      { from_node: 'CANCEL_REQ', to_node: 'CANCEL_REV' },
      { from_node: 'CANCEL_REV', to_node: 'END', outcome: 'COMMIT_CANCELLATION' },
      { from_node: 'CANCEL_REV', to_node: 'SCRUTINY', outcome: 'REJECT_CANCELLATION' },
      { from_node: 'JOIN', to_node: 'ROUTE' },
      { from_node: 'ROUTE', to_node: 'ISSUE_PORT', outcome: 'ISSUE' },
      { from_node: 'ROUTE', to_node: 'END' },
      { from_node: 'ISSUE_PORT', to_node: 'END' },
    ],
  };
}

export function linearGraph(): WorkflowGraph {
  return {
    nodes: [
      { node_id: 'START', kind: 'START' },
      { node_id: 'REVIEW', kind: 'HUMAN_TASK', assignment: { ...ASSIGN } },
      { node_id: 'END', kind: 'END' },
    ],
    edges: [
      { from_node: 'START', to_node: 'REVIEW' },
      { from_node: 'REVIEW', to_node: 'END', outcome: 'APPROVE' },
    ],
  };
}

export function model(graph: WorkflowGraph = richGraph(), versionId = V1): CanonicalWorkflowModel {
  return toCanonicalModel(versionId, graph);
}

let seq = 0;
export function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
}

export function committed(
  outcome: string,
  overrides: Partial<CommittedSignal> = {},
): CommittedSignal {
  return {
    signal_id: uuid(),
    source_component: 'CMP-015',
    tenant_id: T1,
    application_id: APP,
    workflow_version_id: V1,
    command_id: uuid(),
    outcome,
    phase: 'DOMAIN_COMMITTED',
    domain_committed: true,
    outbox_event_id: uuid(),
    ...overrides,
  };
}

export const CORRELATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const TRACE = '0af7651916cd43dd8448eb211c80319c';

export function startInput(
  m: CanonicalWorkflowModel = model(),
  over: Partial<WorkflowStartInput> = {},
): WorkflowStartInput {
  return {
    tenant_id: T1,
    cell_id: 'cell-local-1',
    correlation_id: CORRELATION,
    trace_id: TRACE,
    application_id: APP,
    workflow_version_id: m.workflow_version_id,
    graph_hash: m.graph_hash,
    model: m,
    ...over,
  };
}
