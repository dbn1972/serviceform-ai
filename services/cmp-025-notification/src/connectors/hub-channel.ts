import type { ConnectorMode } from '../domain/model.js';
import type { ChannelConnector, SendRequest, SendResult } from '../ports/channel-connector.js';

export interface HubDeliveryRequest {
  mode: Exclude<ConnectorMode, 'SIMULATED'>;
  connectorBindingId: string;
  /** Reference into the external secret store. The value is resolved by CMP-037, never here. */
  secretRef: string;
  request: SendRequest;
}

export type HubDeliveryResponse =
  | { status: 'ACCEPTED'; providerMessageRef: string }
  | { status: 'TRANSIENT_FAILURE'; errorCode: string }
  | { status: 'PERMANENT_FAILURE'; errorCode: string };

/** Outbound port to the CMP-037 Integration Hub for REAL and SANDBOX delivery (INT-013). */
export interface HubTransport {
  deliver(request: HubDeliveryRequest): Promise<HubDeliveryResponse>;
}

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** REAL/SANDBOX adapter. A hub fault is a transient failure; the raw error is never surfaced. */
export class HubChannelConnector implements ChannelConnector {
  constructor(
    readonly mode: Exclude<ConnectorMode, 'SIMULATED'>,
    readonly connectorBindingId: string,
    private readonly secretRef: string,
    private readonly transport: HubTransport,
  ) {}

  async send(request: SendRequest): Promise<SendResult> {
    try {
      const out = await this.transport.deliver({
        mode: this.mode,
        connectorBindingId: this.connectorBindingId,
        secretRef: this.secretRef,
        request,
      });
      if (out.status === 'ACCEPTED') {
        if (typeof out.providerMessageRef !== 'string' || out.providerMessageRef.length === 0) {
          return { status: 'TRANSIENT_FAILURE', errorCode: 'HUB_RESPONSE_INVALID' };
        }
        return { status: 'ACCEPTED', providerMessageRef: out.providerMessageRef.slice(0, 200) };
      }
      const errorCode = CODE.test(out.errorCode) ? out.errorCode : 'HUB_RESPONSE_INVALID';
      return { status: out.status, errorCode };
    } catch {
      return { status: 'TRANSIENT_FAILURE', errorCode: 'HUB_UNAVAILABLE' };
    }
  }
}
