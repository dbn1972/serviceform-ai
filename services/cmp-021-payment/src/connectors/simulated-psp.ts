import { createHmac } from 'node:crypto';
import type {
  GatewayCallbackPayload,
  GatewayCallbackResult,
  GatewaySessionRequest,
  GatewaySessionResult,
  PaymentGatewayPort,
} from '../ports/payment-gateway-port.js';
import type { SimulationMarker } from '../domain/simulation.js';

/**
 * SIMULATED PSP adapter. No network calls. Uses Constitution #14: exercises the full intent →
 * callback → outbox → workflow path. HMAC verification uses a deterministic secret derived from
 * the test_run_id, never a production credential.
 */
export class SimulatedPspConnector implements PaymentGatewayPort {
  readonly mode = 'SIMULATED' as const;
  readonly simulation: SimulationMarker;

  constructor(simulation: SimulationMarker) {
    this.simulation = simulation;
  }

  createSession(request: GatewaySessionRequest): Promise<GatewaySessionResult> {
    return Promise.resolve({
      pspSessionRef: `sim:${request.paymentIntentId}:${this.simulation.test_run_id}`,
      pspRedirectUrl: `https://simulator.local/pay/${request.paymentIntentId}`,
      initialStatus: 'CREATED',
    });
  }

  verifyCallback(payload: GatewayCallbackPayload): Promise<GatewayCallbackResult> {
    const raw = payload.raw as Record<string, unknown>;
    const paymentIntentId = String(raw['payment_intent_id'] ?? '');
    const outcome = (raw['outcome'] as string | undefined) ?? 'CAPTURED';
    const signature = header(payload.headers, 'x-sim-signature');

    let verified = false;
    if (signature) {
      const secret = simulatorSecret(this.simulation.test_run_id);
      const expected = signPayload(secret, raw);
      verified = timingSafeEqual(signature, expected);
    }

    return Promise.resolve({
      paymentIntentId,
      verified,
      outcome: outcome === 'FAILED' ? 'FAILED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'CAPTURED',
      pspTransactionRef: verified ? `sim-txn:${paymentIntentId}` : undefined,
    });
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/** Deterministic test secret — never a production credential. */
export function simulatorSecret(testRunId: string): string {
  return `sim-secret:${testRunId}`;
}

export function signPayload(secret: string, payload: Record<string, unknown>): string {
  const body = JSON.stringify(payload);
  return createHmac('sha256', secret).update(body).digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
