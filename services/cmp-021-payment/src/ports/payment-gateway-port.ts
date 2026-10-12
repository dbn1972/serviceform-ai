import { Cmp021Error, detail } from '../errors.js';
import type { SimulationMarker } from '../domain/simulation.js';

export interface GatewaySessionRequest {
  paymentIntentId: string;
  tenantId: string;
  applicationId: string;
  feeQuoteId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  simulationMarker: SimulationMarker | null;
}

export interface GatewaySessionResult {
  pspSessionRef: string;
  pspRedirectUrl: string | null;
  /** CREATED when the PSP acknowledged; AUTHORIZED when pre-authorized (e.g. card present). */
  initialStatus: 'CREATED' | 'AUTHORIZED';
}

export interface GatewayCallbackPayload {
  raw: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface GatewayCallbackResult {
  paymentIntentId: string;
  verified: boolean;
  outcome: 'CAPTURED' | 'FAILED' | 'CANCELLED';
  pspTransactionRef?: string | undefined;
}

/**
 * Port for PSP interactions. Both calls must be made OUTSIDE any open DB transaction
 * (Constitution #11 / assertNoOpenTx). SIMULATED adapter never reaches the network.
 */
export interface PaymentGatewayPort {
  createSession(request: GatewaySessionRequest): Promise<GatewaySessionResult>;
  verifyCallback(payload: GatewayCallbackPayload): Promise<GatewayCallbackResult>;
}

export class UnboundPaymentGatewayPort implements PaymentGatewayPort {
  createSession(): Promise<GatewaySessionResult> {
    return Promise.reject(new Cmp021Error('SF-INT-001', detail('PAYMENT_GATEWAY_PORT_UNBOUND')));
  }
  verifyCallback(): Promise<GatewayCallbackResult> {
    return Promise.reject(new Cmp021Error('SF-INT-001', detail('PAYMENT_GATEWAY_PORT_UNBOUND')));
  }
}
