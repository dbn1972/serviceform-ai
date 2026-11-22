import {
  toPortalPrivacyRequest,
  type PlatformPrivacyRequest,
} from '../../../../../../lib/portal/privacy';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Invalid request id' });
  }
  const res = await platform('GET', `/v1/privacy/requests/${id}`, {
    token: citizen.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const row = (res.body['request'] ?? res.body) as PlatformPrivacyRequest;
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    request: toPortalPrivacyRequest(row),
    scope: res.body['scope'] ?? [],
    tasks: res.body['tasks'] ?? [],
    task_counts: res.body['task_counts'] ?? null,
  });
}

/** Withdraw a privacy request (CMP-061). Consent withdrawal uses this orchestration path. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Invalid request id' });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.['action'] !== 'WITHDRAW') {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Only WITHDRAW is supported on this route',
    });
  }
  const res = await platform('POST', `/v1/privacy/requests/${id}/withdraw`, {
    token: citizen.token,
    from: request,
    idempotent: true,
    body: {},
  });
  if (res.status !== 200) return relay(res, 'Withdraw refused');
  const row = (res.body['request'] ?? res.body) as PlatformPrivacyRequest;
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    request: toPortalPrivacyRequest(row),
  });
}
