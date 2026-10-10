import { Cmp025Error, detail } from '../errors.js';
import type { ConnectorBindingView } from '../domain/simulation.js';

/**
 * Read port to CMP-037 Integration Hub (INT-013). CMP-025 never reads hub tables; the binding is
 * resolved over the component boundary and always re-validated by assertBindingPolicy.
 */
export interface ConnectorBindingPort {
  resolve(tenantId: string, connectorBindingId: string): Promise<ConnectorBindingView | null>;
}

export class UnboundConnectorBindingPort implements ConnectorBindingPort {
  resolve(): Promise<ConnectorBindingView | null> {
    return Promise.reject(new Cmp025Error('SF-INT-001', detail('CONNECTOR_BINDING_PORT_UNBOUND')));
  }
}
