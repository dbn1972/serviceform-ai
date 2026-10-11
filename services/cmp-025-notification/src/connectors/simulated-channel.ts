import { Cmp025Error, detail } from '../errors.js';
import type { ConnectorBindingView, SimulationMarker } from '../domain/simulation.js';
import { buildSimulationMarker } from '../domain/simulation.js';
import type { Channel } from '../domain/model.js';
import type { ChannelConnector, SendRequest, SendResult } from '../ports/channel-connector.js';

export type SimulatedScenario = 'accepted' | 'transient_failure' | 'permanent_failure' | 'timeout';

export interface SinkRecord {
  dispatchId: string;
  attemptNo: number;
  channel: Channel;
  locale: string;
  recipientHandleRef: string;
  subject: string | null;
  /** Rendered body, visibly marked TEST/SIMULATED with the test run id (simulators/README.md). */
  body: string;
  simulation: SimulationMarker;
}

/**
 * SMS/Email sink: records rendered templates and delivery outcomes without controlling application
 * state. Never stores the resolved address and never reaches the network.
 */
export class SimulatedChannelConnector implements ChannelConnector {
  readonly mode = 'SIMULATED' as const;
  readonly simulation: SimulationMarker;
  readonly sink: SinkRecord[] = [];

  constructor(
    readonly connectorBindingId: string,
    binding: ConnectorBindingView,
    channel: Channel,
    testRunId: string,
    private readonly scenarioFor: (handleRef: string) => SimulatedScenario = () => 'accepted',
  ) {
    const marker = buildSimulationMarker(binding, channel, testRunId);
    if (marker === null) {
      throw new Cmp025Error('SF-INT-001', detail('SIMULATION_MARKER_UNAVAILABLE'));
    }
    this.simulation = marker;
  }

  send(request: SendRequest): Promise<SendResult> {
    if (request.signal.aborted) {
      return Promise.resolve({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'SEND_ABORTED',
        simulation: this.simulation,
      });
    }
    const scenario = this.scenarioFor(request.recipientHandleRef);
    this.sink.push({
      dispatchId: request.dispatchId,
      attemptNo: request.attemptNo,
      channel: request.channel,
      locale: request.locale,
      recipientHandleRef: request.recipientHandleRef,
      subject: request.subject,
      body: `[TEST/SIMULATED run=${this.simulation.test_run_id}] ${request.body}`,
      simulation: this.simulation,
    });
    if (scenario === 'timeout') {
      return Promise.reject(new Error('simulated connector timeout'));
    }
    if (scenario === 'transient_failure') {
      return Promise.resolve({
        status: 'TRANSIENT_FAILURE',
        errorCode: 'PROVIDER_UNAVAILABLE',
        simulation: this.simulation,
      });
    }
    if (scenario === 'permanent_failure') {
      return Promise.resolve({
        status: 'PERMANENT_FAILURE',
        errorCode: 'RECIPIENT_REJECTED',
        simulation: this.simulation,
      });
    }
    return Promise.resolve({
      status: 'ACCEPTED',
      providerMessageRef: `sim:${request.providerIdempotencyKey}`,
      simulation: this.simulation,
    });
  }
}
