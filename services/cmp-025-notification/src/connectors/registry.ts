import type { ConnectorBindingView } from '../domain/simulation.js';
import type { ChannelConnector, ChannelConnectorRegistry } from '../ports/channel-connector.js';
import { HubChannelConnector, type HubTransport } from './hub-channel.js';
import { SimulatedChannelConnector, type SimulatedScenario } from './simulated-channel.js';
import { CHANNELS, isOneOf, type Channel } from '../domain/model.js';

export interface RegistryOptions {
  /** Present only in simulation environments. */
  simulation?: { testRunId: string; scenarioFor?: (handleRef: string) => SimulatedScenario };
  hub?: HubTransport;
}

const TYPE_TO_CHANNEL: Readonly<Record<string, Channel>> = { SMS: 'SMS', EMAIL: 'EMAIL' };

export class DefaultConnectorRegistry implements ChannelConnectorRegistry {
  private readonly simulated = new Map<string, SimulatedChannelConnector>();

  constructor(private readonly opts: RegistryOptions) {}

  simulatedConnector(connectorBindingId: string): SimulatedChannelConnector | undefined {
    return this.simulated.get(connectorBindingId);
  }

  forBinding(binding: ConnectorBindingView): ChannelConnector | null {
    if (binding.mode === 'SIMULATED') {
      const sim = this.opts.simulation;
      const channel = TYPE_TO_CHANNEL[binding.connector_type];
      if (!sim || channel === undefined || !isOneOf(CHANNELS, channel)) return null;
      const existing = this.simulated.get(binding.connector_binding_id);
      if (existing) return existing;
      const created = new SimulatedChannelConnector(
        binding.connector_binding_id,
        binding,
        channel,
        sim.testRunId,
        sim.scenarioFor,
      );
      this.simulated.set(binding.connector_binding_id, created);
      return created;
    }
    if (!this.opts.hub || binding.secret_ref === null) return null;
    return new HubChannelConnector(
      binding.mode,
      binding.connector_binding_id,
      binding.secret_ref,
      this.opts.hub,
    );
  }
}
