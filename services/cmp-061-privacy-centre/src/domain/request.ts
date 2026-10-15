export const CONTRACT_ID = 'SF-CON-PRIVACY-REQUEST';
export const REQUEST_RESOURCE_TYPE = 'PrivacyRequest';
export const TASK_RESOURCE_TYPE = 'PrivacyFulfilmentTask';
export const SELF_COMPONENT = 'CMP-061';
export const MAX_SCOPE_ITEMS = 32;

export const REQUEST_TYPES = [
  'ACCESS',
  'CORRECTION',
  'ERASURE',
  'PORTABILITY',
  'CONSENT_WITHDRAWAL',
  'RESTRICT',
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const LIFECYCLE_STATES = [
  'SUBMITTED',
  'TASKS_REQUESTED',
  'COMPLETED',
  'WITHDRAWN',
  'DENIED_WITH_BASIS_REF',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATES)[number];

export const TERMINAL_STATES: readonly LifecycleStatus[] = [
  'COMPLETED',
  'WITHDRAWN',
  'DENIED_WITH_BASIS_REF',
];

export const TASK_STATES = ['REQUESTED', 'COMPLETED', 'EXCEPTION_RECORDED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATES)[number];
export type TaskOutcome = 'COMPLETED' | 'EXCEPTION_RECORDED';

const NEXT: Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>> = {
  SUBMITTED: ['TASKS_REQUESTED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF'],
  TASKS_REQUESTED: ['COMPLETED', 'WITHDRAWN', 'DENIED_WITH_BASIS_REF'],
  COMPLETED: [],
  WITHDRAWN: [],
  DENIED_WITH_BASIS_REF: [],
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return NEXT[from].includes(to);
}

export function isTerminal(status: LifecycleStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function isRequestType(v: unknown): v is RequestType {
  return typeof v === 'string' && (REQUEST_TYPES as readonly string[]).includes(v);
}

/**
 * Opaque reference shape shared by scope, evidence, authority and legal-basis refs. The Centre
 * stores and forwards these refs; it never parses or interprets them as statute.
 */
export const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
export const OWNER_COMPONENT = /^CMP-0\d{2}$/;

export function isOpaqueRef(v: unknown): v is string {
  return typeof v === 'string' && OPAQUE_REF.test(v);
}

export function isOwnerComponent(v: unknown): v is string {
  return typeof v === 'string' && OWNER_COMPONENT.test(v) && v !== SELF_COMPONENT;
}

export interface ScopeItem {
  scope_seq: number;
  owner_component: string;
  scope_ref: string;
}

export interface PrivacyRequestRecord {
  tenant_id: string;
  request_id: string;
  subject_actor_id: string;
  request_type: RequestType;
  lifecycle_status: LifecycleStatus;
  legal_basis_or_exception_ref: string | null;
  submit_assurance: 'OTP' | 'PASSWORD' | 'MFA';
  idempotency_key: string;
  request_version: number;
  scope_count: number;
  correlation_id: string;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface FulfilmentTaskRecord {
  tenant_id: string;
  task_id: string;
  request_id: string;
  scope_seq: number;
  owner_component: string;
  task_status: TaskStatus;
  evidence_ref: string | null;
  legal_basis_or_exception_ref: string | null;
  exception_authority_ref: string | null;
  task_version: number;
  created_at: string;
  updated_at: string;
  last_correlation_id: string;
}

export interface PrivacyRequestContract {
  contract_id: typeof CONTRACT_ID;
  contract_status: 'FROZEN';
  freeze_status: 'FROZEN';
  tenant_id: string;
  idempotency_key: string;
  invented_statutory_policy_forbidden: true;
  correlation_id: string;
  request_id: string;
  request_type: RequestType;
  lifecycle_status: LifecycleStatus;
  legal_basis_or_exception_ref: string | null;
  cross_component_direct_mutation_forbidden: true;
  owner_task_orchestration_only: true;
}

export function toContract(row: PrivacyRequestRecord): PrivacyRequestContract {
  return {
    contract_id: CONTRACT_ID,
    contract_status: 'FROZEN',
    freeze_status: 'FROZEN',
    tenant_id: row.tenant_id,
    idempotency_key: row.idempotency_key,
    invented_statutory_policy_forbidden: true,
    correlation_id: row.correlation_id,
    request_id: row.request_id,
    request_type: row.request_type,
    lifecycle_status: row.lifecycle_status,
    legal_basis_or_exception_ref: row.legal_basis_or_exception_ref,
    cross_component_direct_mutation_forbidden: true,
    owner_task_orchestration_only: true,
  };
}

export interface TaskCounts {
  requested: number;
  completed: number;
  exception_recorded: number;
  cancelled: number;
}

export function countTasks(tasks: readonly FulfilmentTaskRecord[]): TaskCounts {
  const counts: TaskCounts = { requested: 0, completed: 0, exception_recorded: 0, cancelled: 0 };
  for (const t of tasks) {
    if (t.task_status === 'REQUESTED') counts.requested += 1;
    else if (t.task_status === 'COMPLETED') counts.completed += 1;
    else if (t.task_status === 'EXCEPTION_RECORDED') counts.exception_recorded += 1;
    else counts.cancelled += 1;
  }
  return counts;
}

/** A request completes only once every owner task has reported an outcome. */
export function allOwnerOutcomesReceived(tasks: readonly FulfilmentTaskRecord[]): boolean {
  return (
    tasks.length > 0 &&
    tasks.every((t) => t.task_status === 'COMPLETED' || t.task_status === 'EXCEPTION_RECORDED')
  );
}
