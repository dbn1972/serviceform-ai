import type { RequestContext } from '@serviceform/contracts';

export interface GatewayModelPin {
  provider_id: string;
  model_id: string;
  model_version: string;
}

export interface GatewayInvokeRequest {
  policy_id: string;
  policy_version: number;
  purpose: string;
  data_classification: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
  caller_component: 'CMP-014';
  variables: Record<string, string>;
  sources: { source_id: string; tenant_id: string }[];
  model?: GatewayModelPin;
}

export interface GatewayInvokeSuccess {
  ok: true;
  request_id: string;
  model: GatewayModelPin;
  output_text: string;
  prompt_hash: string;
  advisory_only: true;
  statutory_decision: false;
}

export interface GatewayInvokeFailure {
  ok: false;
  kind: 'DENIED' | 'TIMEOUT' | 'UNAVAILABLE' | 'UNSAFE';
  reason_code: string;
}

export type GatewayInvokeResult = GatewayInvokeSuccess | GatewayInvokeFailure;

/**
 * CMP-039 AI Gateway port. The only legal inference path.
 * Implementations must be HTTP/in-process gateway clients — never provider SDKs.
 */
export interface AiGatewayPort {
  invoke(
    ctx: RequestContext,
    request: GatewayInvokeRequest,
    signal: AbortSignal,
  ): Promise<GatewayInvokeResult>;
}
