import { Cmp012Error, detail } from '../errors.js';
import type { ConnectorBindingView } from '../domain/simulation.js';

export interface ConnectorBindingPort {
  resolve(tenantId: string, connectorBindingId: string): Promise<ConnectorBindingView | null>;
  resolveDefault(
    tenantId: string,
    connectorType: 'DIGILOCKER',
  ): Promise<ConnectorBindingView | null>;
}

export class UnboundConnectorBindingPort implements ConnectorBindingPort {
  resolve(): Promise<ConnectorBindingView | null> {
    throw new Cmp012Error('SF-SYS-001', detail('CONNECTOR_BINDING_PORT_UNBOUND'));
  }
  resolveDefault(): Promise<ConnectorBindingView | null> {
    throw new Cmp012Error('SF-SYS-001', detail('CONNECTOR_BINDING_PORT_UNBOUND'));
  }
}
