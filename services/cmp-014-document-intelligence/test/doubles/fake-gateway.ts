import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type {
  AiGatewayPort,
  GatewayInvokeRequest,
  GatewayInvokeResult,
} from '../../src/ports/gateway-port.js';

export type GatewayScenario =
  | 'success'
  | 'low_confidence'
  | 'fail'
  | 'timeout'
  | 'unauthorized_model'
  | 'unauthorized_prompt'
  | 'binding_decision';

export class FakeGateway implements AiGatewayPort {
  scenario: GatewayScenario = 'success';
  lastRequest: GatewayInvokeRequest | undefined;
  calls = 0;
  inTxProbe: (() => boolean) | undefined;

  async invoke(
    _ctx: RequestContext,
    request: GatewayInvokeRequest,
    signal: AbortSignal,
  ): Promise<GatewayInvokeResult> {
    if (this.inTxProbe?.()) throw new Error('gateway called inside transaction');
    this.calls += 1;
    this.lastRequest = request;
    if (signal.aborted) {
      return { ok: false, kind: 'TIMEOUT', reason_code: 'GATEWAY_TIMEOUT' };
    }
    if (this.scenario === 'timeout') {
      return { ok: false, kind: 'TIMEOUT', reason_code: 'GATEWAY_TIMEOUT' };
    }
    if (this.scenario === 'fail') {
      return { ok: false, kind: 'UNAVAILABLE', reason_code: 'GATEWAY_UNAVAILABLE' };
    }
    if (this.scenario === 'unauthorized_model') {
      return { ok: false, kind: 'DENIED', reason_code: 'UNAUTHORIZED_MODEL' };
    }
    if (this.scenario === 'unauthorized_prompt') {
      return { ok: false, kind: 'DENIED', reason_code: 'UNAUTHORIZED_PROMPT' };
    }
    if (this.scenario === 'binding_decision') {
      return {
        ok: true,
        request_id: randomUUID(),
        model: { provider_id: 'sim-primary', model_id: 'sim-model', model_version: '2026-10-01' },
        output_text: JSON.stringify({
          fields: [{ name: 'outcome', value: 'applicant is eligible', confidence: 0.99 }],
          overall_confidence: 0.99,
        }),
        prompt_hash: 'sha256:' + 'a'.repeat(64),
        advisory_only: true,
        statutory_decision: false,
      };
    }
    const confidence = this.scenario === 'low_confidence' ? 0.4 : 0.92;
    return {
      ok: true,
      request_id: randomUUID(),
      model: { provider_id: 'sim-primary', model_id: 'sim-model', model_version: '2026-10-01' },
      output_text: JSON.stringify({
        fields: [{ name: 'locality', value: 'assistive-locality', confidence }],
        overall_confidence: confidence,
        advisory_only: true,
        statutory_decision: false,
      }),
      prompt_hash: 'sha256:' + 'b'.repeat(64),
      advisory_only: true,
      statutory_decision: false,
    };
  }
}
