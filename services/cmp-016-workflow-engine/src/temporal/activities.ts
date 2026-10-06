import type { Effect } from '../domain/interpreter.js';
import type {
  HumanTaskPort,
  ProcessPort,
  RuleEvaluationPort,
  ServiceActivityPort,
  TimerPolicyPort,
  WorkflowContext,
} from '../ports.js';
import type { WorkflowEvent } from './workflow.js';
import type { WorkflowStartInput } from './adapter.js';

export interface ActivityPorts {
  humanTasks: HumanTaskPort;
  rules: RuleEvaluationPort;
  activities: ServiceActivityPort;
  processPorts: ProcessPort;
  timers: TimerPolicyPort;
}

/** What an effect produced: an event to feed back, a timer to arm, or nothing. */
export type EffectOutcome =
  | { kind: 'EVENT'; event: WorkflowEvent }
  | { kind: 'ARM_TIMER'; node_id: string; token_id: number; duration_ms: number }
  | { kind: 'DISARM_TIMER'; node_id: string; token_id: number }
  | { kind: 'NONE' };

export function effectIdempotencyKey(
  input: WorkflowStartInput,
  nodeId: string,
  tokenId: number,
  op: string,
): string {
  return `wf.${input.application_id}.${nodeId}.${tokenId}.${op}`;
}

/**
 * Temporal activity implementations. Each calls exactly one sibling port through its published
 * contract. None of them writes CMP-015 case state.
 */
export async function performEffect(
  ports: ActivityPorts,
  ctx: WorkflowContext,
  input: WorkflowStartInput,
  effect: Effect,
): Promise<EffectOutcome> {
  switch (effect.type) {
    case 'CREATE_HUMAN_TASK':
      await ports.humanTasks.create(ctx, {
        application_id: input.application_id,
        workflow_node_id: effect.node_id,
        assignment: effect.assignment,
        idempotency_key: effectIdempotencyKey(input, effect.node_id, effect.token_id, 'create'),
      });
      return { kind: 'NONE' };
    case 'CLOSE_HUMAN_TASK':
      await ports.humanTasks.cancelClose(ctx, {
        application_id: input.application_id,
        workflow_node_id: effect.node_id,
        idempotency_key: effectIdempotencyKey(input, effect.node_id, effect.token_id, 'close'),
      });
      return { kind: 'NONE' };
    case 'EVALUATE_RULE': {
      const r = await ports.rules.evaluate(ctx, {
        application_id: input.application_id,
        node_id: effect.node_id,
        rule_ref: effect.rule_ref,
      });
      return {
        kind: 'EVENT',
        event: { type: 'RESULT', node_id: effect.node_id, kind: 'RULE', outcome: r.outcome },
      };
    }
    case 'INVOKE_ACTIVITY': {
      const r = await ports.activities.invoke(ctx, {
        application_id: input.application_id,
        node_id: effect.node_id,
        kind: effect.kind,
      });
      return {
        kind: 'EVENT',
        event: {
          type: 'RESULT',
          node_id: effect.node_id,
          kind: 'ACTIVITY',
          ...(r.outcome === undefined ? {} : { outcome: r.outcome }),
        },
      };
    }
    case 'INVOKE_PORT': {
      const r = await ports.processPorts.invoke(ctx, {
        application_id: input.application_id,
        node_id: effect.node_id,
        port: effect.port,
      });
      return {
        kind: 'EVENT',
        event: {
          type: 'RESULT',
          node_id: effect.node_id,
          kind: 'PORT',
          ...(r.outcome === undefined ? {} : { outcome: r.outcome }),
        },
      };
    }
    case 'START_TIMER': {
      const duration = await ports.timers.durationMs(ctx, {
        workflow_version_id: input.workflow_version_id,
        node_id: effect.node_id,
      });
      return {
        kind: 'ARM_TIMER',
        node_id: effect.node_id,
        token_id: effect.token_id,
        duration_ms: duration,
      };
    }
    case 'CANCEL_TIMER':
      return { kind: 'DISARM_TIMER', node_id: effect.node_id, token_id: effect.token_id };
    default:
      return { kind: 'NONE' };
  }
}
