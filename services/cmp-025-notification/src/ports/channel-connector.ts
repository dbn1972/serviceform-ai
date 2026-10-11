import type { Channel, ConnectorMode } from '../domain/model.js';
import type { ConnectorBindingView, SimulationMarker } from '../domain/simulation.js';

export interface SendRequest {
  tenantId: string;
  dispatchId: string;
  attemptNo: number;
  channel: Channel;
  locale: string;
  /** Deliverable address. Sensitive: must never be logged, persisted or echoed in errors. */
  address: string;
  recipientHandleRef: string;
  subject: string | null;
  body: string;
  /** Stable per dispatch so providers can de-duplicate at-least-once delivery. */
  providerIdempotencyKey: string;
  signal: AbortSignal;
}

export type SendResult =
  | { status: 'ACCEPTED'; providerMessageRef: string; simulation?: SimulationMarker }
  | { status: 'TRANSIENT_FAILURE'; errorCode: string; simulation?: SimulationMarker }
  | { status: 'PERMANENT_FAILURE'; errorCode: string; simulation?: SimulationMarker };

/** INT-013 channel adapter. REAL/SANDBOX adapters live behind CMP-037; SIMULATED is a sink. */
export interface ChannelConnector {
  readonly mode: ConnectorMode;
  readonly connectorBindingId: string;
  readonly simulation?: SimulationMarker;
  send(request: SendRequest): Promise<SendResult>;
}

export interface ChannelConnectorRegistry {
  /** Returns null when no adapter is bound for the binding: the caller fails closed. */
  forBinding(binding: ConnectorBindingView): ChannelConnector | null;
}
