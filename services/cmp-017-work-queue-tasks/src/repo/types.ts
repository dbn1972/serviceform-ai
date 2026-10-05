import type { EventEnvelope, RequestContext } from '../contracts.js';
import type { Assignment } from '../domain/assignment.js';
import type { PrincipalScope } from '../domain/resolution.js';
import type { Operation, TaskState } from '../domain/states.js';

export interface StoredIdempotent {
  status: number;
  body: unknown;
}

export interface TaskRow {
  tenant_id: string;
  task_id: string;
  application_id: string;
  workflow_node_id: string | null;
  cell_id: string;
  task_state: TaskState;
  assignment: Assignment;
  claimed_principal_id: string | null;
  claimed_at: string | null;
  outcome: string | null;
  created_by: string;
  correlation_id: string;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}

export interface NewTask {
  task_id: string;
  application_id: string;
  workflow_node_id: string | null;
  cell_id: string;
  assignment: Assignment;
  created_by: string;
  correlation_id: string;
  now: Date;
}

export interface TaskPatch {
  task_state: TaskState;
  assignment: Assignment;
  claimed_principal_id: string | null;
  claimed_at: Date | null;
  outcome: string | null;
  expected_version: number;
  now: Date;
}

export interface HistoryRow {
  history_id: string;
  task_id: string;
  seq: number;
  operation: Operation;
  from_state: TaskState | null;
  to_state: TaskState;
  actor_type: string;
  actor_id: string;
  assignment: Assignment;
  claimed_principal_id: string | null;
  outcome: string | null;
  authz_decision_id: string;
  policy_revision: string;
  target_authz_decision_id: string | null;
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string;
}

export type NewHistory = Omit<HistoryRow, 'occurred_at' | 'seq'> & { now: Date };

export interface TaskReadTx {
  getTask(taskId: string): Promise<TaskRow | null>;
  listAvailable(scope: PrincipalScope, limit: number): Promise<TaskRow[]>;
  listHistory(taskId: string): Promise<HistoryRow[]>;
}

export interface TaskWriteTx extends TaskReadTx {
  claimIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    fingerprint: string;
    now: Date;
  }): Promise<StoredIdempotent | 'claimed'>;
  completeIdempotency(p: {
    principalId: string;
    endpoint: string;
    key: string;
    status: number;
    body: unknown;
  }): Promise<void>;
  lockTask(taskId: string): Promise<TaskRow | null>;
  insertTask(task: NewTask): Promise<TaskRow>;
  updateTask(taskId: string, patch: TaskPatch): Promise<TaskRow>;
  insertHistory(row: NewHistory): Promise<HistoryRow>;
  insertOutbox(envelope: EventEnvelope<object>, topic: string): Promise<void>;
}

/** Each unit runs in one short transaction with tenant context from the server-derived context. */
export interface TaskRepository {
  read<T>(ctx: RepoContext, fn: (tx: TaskReadTx) => Promise<T>): Promise<T>;
  write<T>(ctx: RepoContext, fn: (tx: TaskWriteTx) => Promise<T>): Promise<T>;
}

export type RepoContext = RequestContext & { tenant_id: string };
