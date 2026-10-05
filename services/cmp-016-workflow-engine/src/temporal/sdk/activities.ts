import { invalid } from '../../errors.js';
import type { InstanceState } from '../../domain/interpreter.js';
import type { WorkflowContext } from '../../ports.js';
import { performEffect, type ActivityPorts } from '../activities.js';
import type { WorkflowStartInput } from '../adapter.js';
import type { CanonicalActivities } from './activity-types.js';

/** Upper bound for a single TIMER node duration resolved from SLA/calendar policy. */
export const MAX_TIMER_MS = 366 * 24 * 60 * 60 * 1000;

export interface CanonicalActivityDeps {
  ports: ActivityPorts;
  /** Workload identity of the CMP-016 worker (SYSTEM actor; no human principal). */
  systemActorId: string;
  /** CMP-016's own sequencing projection (WorkflowService.recordProgress); never case state. */
  recordProgress(
    ctx: WorkflowContext,
    input: { application_id: string; state: InstanceState; last_signal_id: string | null },
  ): Promise<void>;
}

/**
 * Temporal activity implementations. Retry-safe: every human-task call carries an idempotency
 * key derived from (application, node, token, operation), which is identical on every retry of
 * the same activity, and progress writes are absolute (not increments).
 */
export function createCanonicalActivities(deps: CanonicalActivityDeps): CanonicalActivities {
  const ctxOf = (input: WorkflowStartInput): WorkflowContext => ({
    tenant_id: input.tenant_id,
    cell_id: input.cell_id,
    actor: { type: 'SYSTEM', id: deps.systemActorId },
    correlation_id: input.correlation_id,
    trace_id: input.trace_id,
  });

  const eventOf = async (
    input: WorkflowStartInput,
    effect: Parameters<typeof performEffect>[3],
  ) => {
    const out = await performEffect(deps.ports, ctxOf(input), input, effect);
    if (out.kind !== 'EVENT') throw invalid('ACTIVITY_RESULT_MISSING');
    return out.event;
  };

  return {
    async createHumanTask(input, effect) {
      await performEffect(deps.ports, ctxOf(input), input, effect);
    },
    async closeHumanTask(input, effect) {
      await performEffect(deps.ports, ctxOf(input), input, effect);
    },
    evaluateRule: (input, effect) => eventOf(input, effect),
    invokeActivity: (input, effect) => eventOf(input, effect),
    invokePort: (input, effect) => eventOf(input, effect),
    async timerDuration(input, effect) {
      const out = await performEffect(deps.ports, ctxOf(input), input, effect);
      if (out.kind !== 'ARM_TIMER') throw invalid('TIMER_DURATION_MISSING');
      if (
        !Number.isFinite(out.duration_ms) ||
        out.duration_ms <= 0 ||
        out.duration_ms > MAX_TIMER_MS
      ) {
        throw invalid('TIMER_DURATION_INVALID');
      }
      return out.duration_ms;
    },
    async recordProgress(input, state) {
      await deps.recordProgress(ctxOf(input), {
        application_id: input.application_id,
        state,
        last_signal_id: state.seen_signals.at(-1) ?? null,
      });
    },
  };
}
