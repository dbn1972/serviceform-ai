import type { Assignment } from '../domain/assignment.js';
import type { Operation, TaskState } from '../domain/states.js';
import type { HistoryRow, TaskRow } from '../repo/types.js';

/** Wire shape of SF-CON-HUMAN-TASK `assignment`: optional members are omitted, never null. */
export interface AssignmentView {
  role_code: string;
  organisation_id: string;
  office_id?: string;
  jurisdiction_id: string;
  service_scope_id?: string;
  claimed_principal_id?: string;
}

export interface TaskView {
  task_id: string;
  application_id: string;
  workflow_node_id?: string;
  task_state: TaskState;
  assignment: AssignmentView;
  outcome?: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryView {
  seq: number;
  operation: Operation;
  from_state: TaskState | null;
  to_state: TaskState;
  actor_type: string;
  actor_id: string;
  assignment: AssignmentView;
  outcome?: string;
  authz_decision_id: string;
  policy_revision: string;
  occurred_at: string;
}

export function assignmentView(a: Assignment, claimedPrincipalId: string | null): AssignmentView {
  const out: AssignmentView = {
    role_code: a.role_code,
    organisation_id: a.organisation_id,
    jurisdiction_id: a.jurisdiction_id,
  };
  if (a.office_id) out.office_id = a.office_id;
  if (a.service_scope_id) out.service_scope_id = a.service_scope_id;
  if (claimedPrincipalId) out.claimed_principal_id = claimedPrincipalId;
  return out;
}

export function taskView(t: TaskRow): TaskView {
  const v: TaskView = {
    task_id: t.task_id,
    application_id: t.application_id,
    task_state: t.task_state,
    assignment: assignmentView(t.assignment, t.claimed_principal_id),
    aggregate_version: t.aggregate_version,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
  if (t.workflow_node_id) v.workflow_node_id = t.workflow_node_id;
  if (t.outcome) v.outcome = t.outcome;
  return v;
}

export function historyView(h: HistoryRow): HistoryView {
  const v: HistoryView = {
    seq: h.seq,
    operation: h.operation,
    from_state: h.from_state,
    to_state: h.to_state,
    actor_type: h.actor_type,
    actor_id: h.actor_id,
    assignment: assignmentView(h.assignment, h.claimed_principal_id),
    authz_decision_id: h.authz_decision_id,
    policy_revision: h.policy_revision,
    occurred_at: h.occurred_at,
  };
  if (h.outcome) v.outcome = h.outcome;
  return v;
}

/** SF-CON-HUMAN-TASK instance carried as the domain event payload; `task_state` is the result state. */
export function humanTaskContract(params: {
  operation: Operation;
  task: TaskRow;
  authzDecisionId: string;
  idempotencyKey: string;
  correlationId: string;
}): Record<string, unknown> {
  const t = params.task;
  const data: Record<string, unknown> = {
    contract_id: 'SF-CON-HUMAN-TASK',
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    owner_component: 'CMP-017',
    tenant_id: t.tenant_id,
    task_id: t.task_id,
    application_id: t.application_id,
    operation: params.operation,
    task_state: t.task_state,
    assignment: assignmentView(t.assignment, t.claimed_principal_id),
    authz_decision_id: params.authzDecisionId,
    idempotency_key: params.idempotencyKey,
    correlation_id: params.correlationId,
  };
  if (t.workflow_node_id) data['workflow_node_id'] = t.workflow_node_id;
  if (t.outcome) data['outcome'] = t.outcome;
  return data;
}
