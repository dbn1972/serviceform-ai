import {
  performEffect,
  type Cmp016Error,
  type Effect,
  type InstanceState,
  type WorkflowContext,
  type WorkflowEvent,
  type WorkflowHost,
  type WorkflowStartInput,
} from '../../src/index.js';
import type { Ports } from './ports.js';

/**
 * Deterministic in-memory stand-in for a Temporal worker (TEST ONLY; never a production
 * runtime). Activity results are queued first, then armed timers fire in order, then external
 * signals are consumed.
 */
export class InMemoryTemporalHost implements WorkflowHost {
  private readonly results: WorkflowEvent[] = [];
  private readonly timers: { node_id: string; token_id: number }[] = [];
  readonly signals: WorkflowEvent[] = [];
  readonly rejections: { event: WorkflowEvent; code: string }[] = [];
  readonly progressLog: InstanceState[] = [];
  readonly dispatched: Effect[] = [];

  constructor(
    private readonly ports: Ports,
    private readonly ctx: WorkflowContext,
  ) {}

  async dispatch(effect: Effect, input: WorkflowStartInput): Promise<void> {
    this.dispatched.push(effect);
    const outcome = await performEffect(this.ports, this.ctx, input, effect);
    if (outcome.kind === 'EVENT') this.results.push(outcome.event);
    if (outcome.kind === 'ARM_TIMER')
      this.timers.push({ node_id: outcome.node_id, token_id: outcome.token_id });
    if (outcome.kind === 'DISARM_TIMER') {
      const i = this.timers.findIndex((t) => t.token_id === outcome.token_id);
      if (i >= 0) this.timers.splice(i, 1);
    }
  }

  async nextEvent(): Promise<WorkflowEvent> {
    const next = this.results.shift() ?? this.signals.shift();
    if (next) return next;
    const timer = this.timers.shift();
    if (timer) return { type: 'TIMER_FIRED', node_id: timer.node_id };
    throw new Error('workflow idle: no pending events');
  }

  async progress(state: InstanceState): Promise<void> {
    this.progressLog.push(structuredClone(state));
  }

  async rejected(event: WorkflowEvent, error: Cmp016Error): Promise<void> {
    this.rejections.push({ event, code: error.details[0]?.code ?? error.code });
  }
}
