import {
  decide,
  issuanceApplies,
  readIssuance,
  readWorkingData,
  requestIssuance,
  toWorkbenchApplication,
  type IssuanceProjection,
  type PlatformApplication,
} from '../../../../../lib/portal/cases';
import {
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
  crossSiteRefusal,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function load(token: string, id: string) {
  const res = await platform('GET', `/v1/applications/${id}`, { token });
  return { res, app: res.body['application'] as PlatformApplication | undefined };
}

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const { res, app } = await load(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);
  return json(200, {
    application: toWorkbenchApplication(
      app,
      await readWorkingData(officer, id),
      await readIssuance(officer, app),
    ),
    source: 'PLATFORM',
  });
}

/**
 * Human decision (`APPROVE` | `REJECT`) recorded on CMP-015 by the signed-in officer. After an
 * APPROVE the platform issues and publishes (SIMULATED); `ISSUE` retries that for an approved case.
 */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'ISSUE') {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'action must be APPROVE, REJECT or ISSUE',
    });
  }
  const { res, app } = await load(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);
  let decided = app;
  if (action === 'ISSUE') {
    if (!issuanceApplies(app.state)) {
      return json(409, { error_code: 'SF-APP-001', message: 'This case has no recorded approval' });
    }
  } else {
    const outcome = await decide(officer, app, action);
    if (!outcome.ok) return relay(outcome.res);
    decided = outcome.app;
  }
  let issuance: IssuanceProjection | null = null;
  if (action !== 'REJECT') {
    const run = await requestIssuance(officer, decided);
    issuance = run.ok
      ? run.issuance
      : {
          case_state: decided.state,
          credential: null,
          digilocker: { mode: 'SIMULATED', status: 'NOT_REQUESTED' },
          issuance_error: {
            error_code:
              typeof run.res.body['error_code'] === 'string'
                ? run.res.body['error_code']
                : 'SF-SYS-004',
            step: 'REQUEST',
          },
        };
    const latest = await load(officer.token, id);
    if (latest.res.status === 200 && latest.app) decided = latest.app;
  }
  return json(200, {
    application: toWorkbenchApplication(decided, await readWorkingData(officer, id), issuance),
    source: 'PLATFORM',
  });
}
