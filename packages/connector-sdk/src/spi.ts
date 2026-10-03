import type { ConnectorBinding, ConnectorMode, SimulationMarker } from '@serviceform/contracts';
import type { SecretResolver } from './secrets.js';

export type InvokeOutcome = 'ok' | 'retryable_error' | 'permanent_error' | 'timeout';

export interface InvokeRequest {
  operation: string;
  payload: unknown;
  request_fingerprint: string;
}

export interface InvokeContext {
  binding: ConnectorBinding;
  secrets: SecretResolver;
  signal: AbortSignal;
  correlation_id: string;
  idempotency_key?: string;
  simulation?: { scenario: string; test_run_id: string };
  attempt: number;
  guardedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface InvokeResult {
  outcome: InvokeOutcome;
  provider_reference?: string;
  error_code?: string;
  retry_after_ms?: number;
  simulation?: SimulationMarker;
  /** Redacted pointer only; never a secret or PII body. */
  response_ref?: string;
}

export interface RawWebhook {
  rawBody: Uint8Array;
  headers: Record<string, string | string[] | undefined>;
}

export interface VerifiedWebhook {
  provider_reference: string;
  outcome: 'ok' | 'permanent_error';
  error_code?: string;
  simulation?: SimulationMarker;
}

export interface HealthResult {
  healthy: boolean;
  detail?: string;
}

export interface ConnectorAdapter {
  readonly connectorType: ConnectorBinding['connector_type'];
  readonly supportedModes: readonly ConnectorMode[];
  invoke(req: InvokeRequest, ctx: InvokeContext): Promise<InvokeResult>;
  verifyWebhook(
    req: RawWebhook,
    ctx: InvokeContext,
  ): Promise<VerifiedWebhook | { ok: false; status: 401 }>;
  health(ctx: Pick<InvokeContext, 'binding' | 'signal'>): Promise<HealthResult>;
}
