import type { Effect, InstanceState } from '../../domain/interpreter.js';
import type { WorkflowStartInput } from '../adapter.js';
import type { WorkflowEvent } from '../workflow.js';

type EffectOf<T extends Effect['type']> = Extract<Effect, { type: T }>;

/**
 * Activity surface of the canonical workflow. Every activity calls a published sibling port
 * (CMP-017, CMP-008, CMP-019/CMP-037, M06/M07 ports, CMP-029) or records CMP-016's own
 * sequencing projection. None of them can change CMP-015 case state.
 */
export interface CanonicalActivities {
  createHumanTask(input: WorkflowStartInput, effect: EffectOf<'CREATE_HUMAN_TASK'>): Promise<void>;
  closeHumanTask(input: WorkflowStartInput, effect: EffectOf<'CLOSE_HUMAN_TASK'>): Promise<void>;
  evaluateRule(
    input: WorkflowStartInput,
    effect: EffectOf<'EVALUATE_RULE'>,
  ): Promise<WorkflowEvent>;
  invokeActivity(
    input: WorkflowStartInput,
    effect: EffectOf<'INVOKE_ACTIVITY'>,
  ): Promise<WorkflowEvent>;
  invokePort(input: WorkflowStartInput, effect: EffectOf<'INVOKE_PORT'>): Promise<WorkflowEvent>;
  timerDuration(input: WorkflowStartInput, effect: EffectOf<'START_TIMER'>): Promise<number>;
  recordProgress(input: WorkflowStartInput, state: InstanceState): Promise<void>;
}

export const CANONICAL_ACTIVITY_NAMES = [
  'createHumanTask',
  'closeHumanTask',
  'evaluateRule',
  'invokeActivity',
  'invokePort',
  'timerDuration',
  'recordProgress',
] as const satisfies readonly (keyof CanonicalActivities)[];

export const QUERY_STATE = 'sf.state';
