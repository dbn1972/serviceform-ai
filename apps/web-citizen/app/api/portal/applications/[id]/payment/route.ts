import { SAMPLE_LAB_FEE_DEFAULTS } from '@serviceform/m10-sample-lab/fee-catalogue';
import {
  toPortalApplication,
  type PlatformApplication,
} from '../../../../../../lib/portal/applications';
import { catalogueIdForCase } from '../../../../../../lib/portal/catalogue-resolve';
import { readIssuance, readWorkingData } from '../../../../../../lib/portal/cases';
import {
  crossSiteRefusal,
  currentCitizen,
  json,
  platform,
  relay,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN_REQUIRED = 'Sign in with your mobile number to continue';

/**
 * SF-56 citizen payment BFF (SIMULATED only).
 * GET  — quote status / amount for PAYMENT_PENDING cases (server-authoritative; no client amount).
 * POST — quote → intent → lab SIM callback (CAPTURED) → MARK_RECEIVED via workflow signal.
 * Client-supplied amounts are refused. Payment REAL remains owner-held.
 */

async function loadOwnedApplication(token: string, id: string) {
  const res = await platform('GET', `/v1/applications/${id}`, { token });
  if (res.status !== 200) return { ok: false as const, res };
  const app = res.body['application'] as PlatformApplication | undefined;
  if (!app) return { ok: false as const, res };
  return { ok: true as const, app };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const { id } = await ctx.params;
  const loaded = await loadOwnedApplication(citizen.token, id);
  if (!loaded.ok) return relay(loaded.res);
  const { app } = loaded;
  const catalogueId = catalogueIdForCase(app);

  if (app.state !== 'PAYMENT_PENDING') {
    return json(200, {
      application: toPortalApplication(
        app,
        await readWorkingData(citizen, app.application_id),
        await readIssuance(citizen, app),
        catalogueId,
      ),
      payment_required: false,
      simulation: true,
      certified: false,
      g6_issued: false,
    });
  }

  const quotes = await platform('GET', `/v1/applications/${id}/fee-quotes`, {
    token: citizen.token,
  });
  const list = (quotes.body['quotes'] as Record<string, unknown>[] | undefined) ?? [];
  const latest = list[0];
  return json(200, {
    application: toPortalApplication(
      app,
      await readWorkingData(citizen, app.application_id),
      null,
      catalogueId,
    ),
    payment_required: true,
    fee_quote: latest
      ? {
          quote_id: latest['quote_id'],
          currency: latest['currency'],
          total_amount_minor: latest['total_amount_minor'],
          amount_display: SAMPLE_LAB_FEE_DEFAULTS.amount_display,
          client_authoritative_amount: false,
          policy_kind: 'SAMPLE_LAB_DUMMY',
        }
      : {
          quote_id: null,
          currency: SAMPLE_LAB_FEE_DEFAULTS.currency,
          total_amount_minor: SAMPLE_LAB_FEE_DEFAULTS.amount_minor,
          amount_display: SAMPLE_LAB_FEE_DEFAULTS.amount_display,
          client_authoritative_amount: false,
          policy_kind: 'SAMPLE_LAB_DUMMY',
          pending_quote: true,
        },
    connector_mode: 'SIMULATED',
    simulation: true,
    certified: false,
    g6_issued: false,
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && ('amount' in body || 'amount_minor' in body || 'total_amount_minor' in body)) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Client-supplied fee amounts are forbidden',
      certified: false,
      g6_issued: false,
    });
  }

  const loaded = await loadOwnedApplication(citizen.token, id);
  if (!loaded.ok) return relay(loaded.res);
  let { app } = loaded;
  if (app.state !== 'PAYMENT_PENDING') {
    return json(409, {
      error_code: 'SF-APP-001',
      message: 'Payment is only available while the application is awaiting fee payment',
      certified: false,
      g6_issued: false,
    });
  }

  const quoteKey = request.headers.get('idempotency-key') ?? `pay-${id.slice(0, 8)}`;
  const quote = await platform('POST', '/v1/fee-quotes', {
    token: citizen.token,
    idempotencyKey: `${quoteKey}-quote`,
    body: { application_id: id },
  });
  if (quote.status !== 201 && quote.status !== 200) return relay(quote);
  const quoteId = String((quote.body as Record<string, unknown>)['quote_id'] ?? '');
  if (!quoteId) {
    return json(502, {
      error_code: 'SF-SYS-004',
      message: 'Fee quote did not return quote_id',
      certified: false,
      g6_issued: false,
    });
  }

  const intent = await platform('POST', '/v1/payment-intents', {
    token: citizen.token,
    idempotencyKey: `${quoteKey}-intent`,
    body: {
      fee_quote_id: quoteId,
      test_run_id: SAMPLE_LAB_FEE_DEFAULTS.test_run_id,
    },
  });
  if (intent.status !== 201 && intent.status !== 200) return relay(intent);
  const paymentIntentId = String(
    (intent.body as Record<string, unknown>)['payment_intent_id'] ?? '',
  );
  if (!paymentIntentId) {
    return json(502, {
      error_code: 'SF-SYS-004',
      message: 'Payment intent did not return payment_intent_id',
      certified: false,
      g6_issued: false,
    });
  }

  // Lab SIM callback (INTEGRATION + HMAC) — same state machine as REAL; REAL deferred.
  const callback = await platform('POST', '/v1/lab/simulated/payment-callback', {
    token: citizen.token,
    idempotencyKey: `${quoteKey}-sim-cb`,
    body: { payment_intent_id: paymentIntentId },
  });
  if (callback.status !== 201 && callback.status !== 200) return relay(callback);

  const refreshed = await loadOwnedApplication(citizen.token, id);
  if (refreshed.ok) app = refreshed.app;
  const catalogueId = catalogueIdForCase(app);

  return json(200, {
    application: toPortalApplication(
      app,
      await readWorkingData(citizen, app.application_id),
      await readIssuance(citizen, app),
      catalogueId,
    ),
    fee_quote_id: quoteId,
    payment_intent_id: paymentIntentId,
    callback: callback.body,
    connector_mode: 'SIMULATED',
    simulation: true,
    policy_kind: 'SAMPLE_LAB_DUMMY',
    certified: false,
    g6_issued: false,
  });
}
