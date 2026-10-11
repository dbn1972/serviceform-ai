import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@serviceform/contracts';
import type {
  AiGatewayPort,
  GatewayInvokeRequest,
  GatewayInvokeResult,
} from '../../src/ports/gateway-port.js';

export type GatewayScenario =
  | 'success'
  | 'two_items'
  | 'unavailable'
  | 'timeout'
  | 'denied'
  | 'unsafe'
  | 'binding_decision'
  | 'invented_candidate'
  | 'free_text'
  | 'bad_reason'
  | 'not_advisory'
  | 'throws';

const MODEL = { provider_id: 'sim-primary', model_id: 'sim-model', model_version: '2026-10-01' };

export class FakeGateway implements AiGatewayPort {
  scenario: GatewayScenario = 'success';
  lastRequest: GatewayInvokeRequest | undefined;
  calls = 0;
  inTxProbe: (() => boolean) | undefined;

  private ok(
    output: unknown,
    extra: Partial<{ advisory_only: boolean }> = {},
  ): GatewayInvokeResult {
    return {
      ok: true,
      request_id: randomUUID(),
      model: MODEL,
      output_text: typeof output === 'string' ? output : JSON.stringify(output),
      prompt_hash: `sha256:${'b'.repeat(64)}`,
      advisory_only: (extra.advisory_only ?? true) as true,
      statutory_decision: false,
    };
  }

  async invoke(
    _ctx: RequestContext,
    request: GatewayInvokeRequest,
    signal: AbortSignal,
  ): Promise<GatewayInvokeResult> {
    if (this.inTxProbe?.()) throw new Error('gateway called inside transaction');
    this.calls += 1;
    this.lastRequest = request;
    if (signal.aborted || this.scenario === 'timeout') {
      return { ok: false, kind: 'TIMEOUT', reason_code: 'GATEWAY_TIMEOUT' };
    }
    switch (this.scenario) {
      case 'throws':
        throw new Error('network down');
      case 'unavailable':
        return { ok: false, kind: 'UNAVAILABLE', reason_code: 'GATEWAY_UNAVAILABLE' };
      case 'denied':
        return { ok: false, kind: 'DENIED', reason_code: 'UNAUTHORIZED_MODEL' };
      case 'unsafe':
        return { ok: false, kind: 'UNSAFE', reason_code: 'UNSAFE_OUTPUT' };
      case 'binding_decision':
        return this.ok({
          items: [{ candidate: 'c1', reason_codes: ['APPLICANT_IS_ELIGIBLE'] }],
        });
      case 'invented_candidate':
        return this.ok({ items: [{ candidate: 'c99', reason_codes: ['CATEGORY_MATCH'] }] });
      case 'free_text':
        return this.ok({
          items: [
            {
              candidate: 'c1',
              reason_codes: ['CATEGORY_MATCH'],
              explanation: 'Your application is approved',
            },
          ],
        });
      case 'bad_reason':
        return this.ok({ items: [{ candidate: 'c1', reason_codes: ['NOT_IN_POLICY'] }] });
      case 'not_advisory':
        return this.ok(
          { items: [{ candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] }] },
          { advisory_only: false },
        );
      case 'two_items':
        return this.ok({
          items: [
            { candidate: 'c2', reason_codes: ['CATEGORY_MATCH', 'JURISDICTION_MATCH'] },
            { candidate: 'c1', reason_codes: ['CATEGORY_MATCH'] },
          ],
        });
      default:
        return this.ok({
          items: [{ candidate: 'c1', reason_codes: ['CATEGORY_MATCH', 'JURISDICTION_MATCH'] }],
          advisory_only: true,
          statutory_decision: false,
        });
    }
  }
}
