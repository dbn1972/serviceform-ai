import type {
  ConnectorAdapter,
  InvokeContext,
  InvokeRequest,
  InvokeResult,
  RawWebhook,
  VerifiedWebhook,
} from '../../../packages/connector-sdk/src/index.js';
import { verifyWebhookSignature } from '../../../packages/connector-sdk/src/index.js';
import {
  buildSimulationMarker,
  deterministicId,
  ECHO_SCENARIOS,
  ECHO_SIMULATOR_VERSION,
  type EchoScenario,
} from './marker.js';

const TRANSIENT_UNTIL_ATTEMPT = 2;

function scenarioOf(ctx: InvokeContext): EchoScenario {
  const raw = ctx.simulation?.scenario ?? 'success';
  return (ECHO_SCENARIOS as readonly string[]).includes(raw) ? (raw as EchoScenario) : 'success';
}

/**
 * Reference echo simulator. Replaces only the provider endpoint; the hub still owns
 * persistence, idempotency and events. DEPARTMENT_API / SIMULATED only.
 */
export class EchoSimulatorAdapter implements ConnectorAdapter {
  readonly connectorType = 'DEPARTMENT_API' as const;
  readonly supportedModes = ['SIMULATED'] as const;
  readonly simulatorVersion = ECHO_SIMULATOR_VERSION;

  async invoke(req: InvokeRequest, ctx: InvokeContext): Promise<InvokeResult> {
    if (ctx.binding.mode !== 'SIMULATED') {
      return { outcome: 'permanent_error', error_code: 'CONNECTOR_MODE_FORBIDDEN' };
    }
    if (!ctx.simulation?.test_run_id) {
      return { outcome: 'permanent_error', error_code: 'SF_SYS_003' };
    }
    const scenario = scenarioOf(ctx);
    const marker = buildSimulationMarker(ctx.binding, {
      scenario,
      test_run_id: ctx.simulation.test_run_id,
    });
    const provider_reference = deterministicId([
      ctx.simulation.test_run_id,
      scenario,
      req.request_fingerprint,
      String(ctx.attempt),
    ]);
    if (scenario === 'timeout') return { outcome: 'timeout', simulation: marker };
    if (scenario === 'fail_permanent') {
      return {
        outcome: 'permanent_error',
        error_code: 'PROVIDER_REJECTED',
        provider_reference,
        simulation: marker,
      };
    }
    if (scenario === 'fail_transient_then_success' && ctx.attempt < TRANSIENT_UNTIL_ATTEMPT) {
      return {
        outcome: 'retryable_error',
        error_code: 'PROVIDER_UNAVAILABLE',
        provider_reference,
        simulation: marker,
      };
    }
    if (scenario === 'malformed_response') {
      return {
        outcome: 'permanent_error',
        error_code: 'MALFORMED_RESPONSE',
        provider_reference,
        simulation: marker,
      };
    }
    return {
      outcome: 'ok',
      provider_reference,
      response_ref: `sim:echo:${provider_reference}`,
      simulation: marker,
    };
  }

  async verifyWebhook(
    req: RawWebhook,
    ctx: InvokeContext,
  ): Promise<VerifiedWebhook | { ok: false; status: 401 }> {
    const secret = await ctx.secrets.resolve(ctx.binding.secret_ref ?? 'vault://sim/echo-webhook');
    const injected = req.headers['x-sf-now'];
    const nowRaw = Array.isArray(injected) ? injected[0] : injected;
    const now = Number.parseInt(nowRaw ?? '0', 10);
    if (!verifyWebhookSignature(req.rawBody, req.headers, secret, Number.isFinite(now) ? now : 0)) {
      return { ok: false, status: 401 };
    }
    const text = new TextDecoder().decode(req.rawBody);
    let parsed: { provider_reference?: string; scenario?: string; test_run_id?: string } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return { ok: false, status: 401 };
    }
    const provider_reference = parsed.provider_reference ?? 'echo-missing';
    const scenario = parsed.scenario ?? 'duplicate_callback';
    const test_run_id = parsed.test_run_id ?? ctx.simulation?.test_run_id;
    const simulation =
      test_run_id && ctx.binding.mode === 'SIMULATED'
        ? buildSimulationMarker(ctx.binding, { scenario, test_run_id })
        : null;
    if (simulation) return { provider_reference, outcome: 'ok', simulation };
    return { provider_reference, outcome: 'ok' };
  }

  async health(
    _ctx: Pick<InvokeContext, 'binding' | 'signal'>,
  ): Promise<{ healthy: boolean; detail: string }> {
    return { healthy: true, detail: 'echo-simulator' };
  }
}
