import {
  ApplicationFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import { Cmp016Error } from '../../errors.js';
import type { Effect, InstanceState } from '../../domain/interpreter.js';
import type { CommittedSignal } from '../../domain/signals.js';
import type { MigrateSignal, WorkflowStartInput } from '../adapter.js';
import { canonicalWorkflow, type WorkflowEvent, type WorkflowHost } from '../workflow.js';
import { QUERY_STATE, type CanonicalActivities } from './activity-types.js';

/**
 * Temporal workflow definitions bundled into the CMP-016 worker. Only the canonical
 * ServiceForm Workflow Model is executed here; there is no BPMN execution path. This module runs
 * in Temporal's deterministic sandbox: no wall clock, randomness, Node built-ins or network.
 * Waits are Temporal conditions, timers are durable Temporal timers, side effects are activities.
 */

export const committedTransitionSignal = defineSignal<[CommittedSignal]>('sf.committedTransition');
export const migrateSignal = defineSignal<[MigrateSignal]>('sf.migrate');
export const stateQuery = defineQuery<InstanceState | null>(QUERY_STATE);

const activities = proxyActivities<CanonicalActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 10,
    nonRetryableErrorTypes: ['Cmp016Error'],
  },
});

function failure(err: Cmp016Error): ApplicationFailure {
  return ApplicationFailure.nonRetryable(err.details[0]?.code ?? err.code, 'Cmp016Error', {
    code: err.code,
    details: err.details,
  });
}

export async function serviceformCanonicalWorkflow(
  input: WorkflowStartInput,
): Promise<InstanceState> {
  const queue: WorkflowEvent[] = [];
  const timers = new Map<number, CancellationScope>();
  let latest: InstanceState | null = null;

  setHandler(committedTransitionSignal, (signal) => {
    queue.push({ type: 'COMMITTED', signal });
  });
  setHandler(migrateSignal, (migrate) => {
    queue.push({ type: 'MIGRATE', migrate });
  });
  setHandler(stateQuery, () => latest);

  const armTimer = (effect: Extract<Effect, { type: 'START_TIMER' }>, ms: number) => {
    const scope = new CancellationScope();
    timers.set(effect.token_id, scope);
    scope
      .run(() => sleep(ms))
      .then(() => {
        timers.delete(effect.token_id);
        queue.push({ type: 'TIMER_FIRED', node_id: effect.node_id });
      })
      .catch((err: unknown) => {
        if (!isCancellation(err)) throw err;
      });
  };

  const host: WorkflowHost = {
    async dispatch(effect) {
      switch (effect.type) {
        case 'CREATE_HUMAN_TASK':
          await activities.createHumanTask(input, effect);
          return;
        case 'CLOSE_HUMAN_TASK':
          await activities.closeHumanTask(input, effect);
          return;
        case 'EVALUATE_RULE':
          queue.push(await activities.evaluateRule(input, effect));
          return;
        case 'INVOKE_ACTIVITY':
          queue.push(await activities.invokeActivity(input, effect));
          return;
        case 'INVOKE_PORT':
          queue.push(await activities.invokePort(input, effect));
          return;
        case 'START_TIMER':
          armTimer(effect, await activities.timerDuration(input, effect));
          return;
        case 'CANCEL_TIMER':
          timers.get(effect.token_id)?.cancel();
          timers.delete(effect.token_id);
          return;
        default:
          return;
      }
    },
    async nextEvent() {
      await condition(() => queue.length > 0);
      return queue.shift() as WorkflowEvent;
    },
    async progress(state) {
      latest = state;
      await activities.recordProgress(input, state);
    },
    async rejected(event, error) {
      log.warn('workflow event rejected', {
        event: event.type,
        code: error.code,
        detail: error.details[0]?.code,
      });
    },
  };

  try {
    return await canonicalWorkflow(host, input);
  } catch (err) {
    if (err instanceof Cmp016Error) throw failure(err);
    throw err;
  }
}
