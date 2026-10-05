export const TASK_STATES = ['OPEN', 'CLAIMED', 'COMPLETED', 'CANCELLED_CLOSED'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const OPERATIONS = [
  'CREATE',
  'CLAIM',
  'UNCLAIM',
  'REASSIGN',
  'COMPLETE',
  'CANCEL_CLOSE',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const TERMINAL_STATES: readonly TaskState[] = ['COMPLETED', 'CANCELLED_CLOSED'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Legal source states per operation; the database trigger enforces the same table. */
const SOURCES: Record<Exclude<Operation, 'CREATE'>, readonly TaskState[]> = {
  CLAIM: ['OPEN'],
  UNCLAIM: ['CLAIMED'],
  REASSIGN: ['OPEN', 'CLAIMED'],
  COMPLETE: ['CLAIMED'],
  CANCEL_CLOSE: ['OPEN', 'CLAIMED'],
};

const TARGET: Record<Exclude<Operation, 'CREATE'>, TaskState> = {
  CLAIM: 'CLAIMED',
  UNCLAIM: 'OPEN',
  REASSIGN: 'OPEN',
  COMPLETE: 'COMPLETED',
  CANCEL_CLOSE: 'CANCELLED_CLOSED',
};

export function canApply(operation: Exclude<Operation, 'CREATE'>, from: TaskState): boolean {
  return SOURCES[operation].includes(from);
}

export function targetState(operation: Exclude<Operation, 'CREATE'>): TaskState {
  return TARGET[operation];
}

export const EVENT_TYPE: Record<Operation, string> = {
  CREATE: 'HumanTaskCreated',
  CLAIM: 'HumanTaskClaimed',
  UNCLAIM: 'HumanTaskUnclaimed',
  REASSIGN: 'HumanTaskReassigned',
  COMPLETE: 'HumanTaskCompleted',
  CANCEL_CLOSE: 'HumanTaskCancelledClosed',
};

export const AUTHZ_ACTION: Record<Operation, string> = {
  CREATE: 'TASK_CREATE',
  CLAIM: 'TASK_CLAIM',
  UNCLAIM: 'TASK_UNCLAIM',
  REASSIGN: 'TASK_REASSIGN',
  COMPLETE: 'TASK_COMPLETE',
  CANCEL_CLOSE: 'TASK_CANCEL_CLOSE',
};
