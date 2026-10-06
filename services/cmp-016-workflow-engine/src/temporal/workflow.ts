import { Cmp016Error } from '../errors.js';
import {
  applyCommitted,
  applyResult,
  applyTimerFired,
  startInstance,
  type Effect,
  type InstanceState,
  type ResultKind,
  type Step,
} from '../domain/interpreter.js';
import { migrateState, validatePlan } from '../domain/migration.js';
import type { CanonicalWorkflowModel } from '../domain/model.js';
import type { CommittedSignal } from '../domain/signals.js';
import { assertHashIntegrity, parseCanonicalModel } from '../domain/validate.js';
import type { MigrateSignal, WorkflowStartInput } from './adapter.js';

export type WorkflowEvent =
  | { type: 'COMMITTED'; signal: CommittedSignal }
  | { type: 'RESULT'; node_id: string; kind: ResultKind; outcome?: string }
  | { type: 'TIMER_FIRED'; node_id: string }
  | { type: 'MIGRATE'; migrate: MigrateSignal };

/**
 * Runtime surface the Temporal workflow body needs. A Temporal worker binds it to
 * proxyActivities (dispatch, progress), workflow timers and signal handlers (nextEvent).
 * Everything here is deterministic: no clock, randomness or network outside the host.
 */
export interface WorkflowHost {
  dispatch(effect: Effect, input: WorkflowStartInput): Promise<void>;
  nextEvent(): Promise<WorkflowEvent>;
  progress(state: InstanceState, input: WorkflowStartInput): Promise<void>;
  rejected(event: WorkflowEvent, error: Cmp016Error): Promise<void>;
}

function apply(
  model: CanonicalWorkflowModel,
  state: InstanceState,
  ev: Exclude<WorkflowEvent, { type: 'MIGRATE' }>,
): Step {
  switch (ev.type) {
    case 'COMMITTED':
      return applyCommitted(model, state, ev.signal);
    case 'RESULT':
      return applyResult(model, state, {
        node_id: ev.node_id,
        kind: ev.kind,
        ...(ev.outcome === undefined ? {} : { outcome: ev.outcome }),
      });
    case 'TIMER_FIRED':
      return applyTimerFired(model, state, ev.node_id);
  }
}

/** Temporal workflow body: sequences the pinned canonical graph until it completes. */
export async function canonicalWorkflow(
  host: WorkflowHost,
  input: WorkflowStartInput,
): Promise<InstanceState> {
  let model = parseCanonicalModel(input.model);
  assertHashIntegrity(model);
  if (
    model.workflow_version_id !== input.workflow_version_id ||
    model.graph_hash !== input.graph_hash
  ) {
    throw new Cmp016Error('SF-WF-001', [{ code: 'PINNED_VERSION_MISMATCH' }]);
  }
  let step: Step = startInstance(model);
  for (;;) {
    for (const effect of step.effects) await host.dispatch(effect, input);
    await host.progress(step.state, input);
    if (step.state.status !== 'RUNNING') return step.state;
    const ev = await host.nextEvent();
    try {
      if (ev.type === 'MIGRATE') {
        const target = parseCanonicalModel(ev.migrate.target.model);
        assertHashIntegrity(target);
        const to = { version_id: ev.migrate.target.version_id, model: target };
        validatePlan(ev.migrate.plan, { model }, to);
        const migrated = migrateState(step.state, ev.migrate.plan, { model }, to);
        model = target;
        step = migrated;
      } else {
        if (
          ev.type === 'COMMITTED' &&
          (ev.signal.tenant_id !== input.tenant_id ||
            ev.signal.application_id !== input.application_id)
        ) {
          throw new Cmp016Error('SF-TEN-002', [{ code: 'SIGNAL_SCOPE_MISMATCH' }]);
        }
        step = apply(model, step.state, ev);
      }
    } catch (err) {
      if (!(err instanceof Cmp016Error)) throw err;
      await host.rejected(ev, err);
      step = { state: step.state, effects: [] };
    }
  }
}
