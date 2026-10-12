import type {
  GatewayCallbackPayload,
  GatewayCallbackResult,
  GatewaySessionRequest,
  GatewaySessionResult,
  PaymentGatewayPort,
} from '../ports/payment-gateway-port.js';

/**
 * Hub PSP transport adapter — REAL/SANDBOX stub. Implements the PaymentGatewayPort interface so
 * it can be injected when CMP-037 provides a live binding. No PSP SDK is imported; all protocol
 * details (auth, webhook crypto) are resolved at integration time via CMP-037 secret_ref.
 *
 * This file provides the structural placeholder only. Actual HTTP calls are wired by the host
 * mount (SF-M06-005). Calling either method in the current state throws to prevent accidental
 * production use of an uninitialized transport.
 */
export class HubPspConnector implements PaymentGatewayPort {
  readonly mode: 'REAL' | 'SANDBOX';
  private readonly baseUrl: string;
  private readonly secretRef: string;

  constructor(params: { mode: 'REAL' | 'SANDBOX'; baseUrl: string; secretRef: string }) {
    this.mode = params.mode;
    this.baseUrl = params.baseUrl;
    this.secretRef = params.secretRef;
  }

  createSession(_request: GatewaySessionRequest): Promise<GatewaySessionResult> {
    return Promise.reject(
      new Error(
        `HubPspConnector.createSession not wired: mode=${this.mode} url=${this.baseUrl} ` +
          `secretRef=${this.secretRef} — host mount required (SF-M06-005)`,
      ),
    );
  }

  verifyCallback(_payload: GatewayCallbackPayload): Promise<GatewayCallbackResult> {
    return Promise.reject(
      new Error(
        `HubPspConnector.verifyCallback not wired: mode=${this.mode} — host mount required`,
      ),
    );
  }
}
