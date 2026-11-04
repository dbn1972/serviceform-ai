import {
  decide,
  readWorkingData,
  toWorkbenchApplication,
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
    application: toWorkbenchApplication(app, await readWorkingData(officer, id)),
    source: 'PLATFORM',
  });
}

/** Human decision (`APPROVE` | `REJECT`) recorded on CMP-015 by the signed-in officer. */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== 'APPROVE' && body?.action !== 'REJECT') {
    return json(400, { error_code: 'SF-SYS-003', message: 'action must be APPROVE or REJECT' });
  }
  const { res, app } = await load(officer.token, id);
  if (res.status !== 200 || !app) return relay(res);
  const outcome = await decide(officer, app, body.action);
  if (!outcome.ok) return relay(outcome.res);
  return json(200, {
    application: toWorkbenchApplication(outcome.app, await readWorkingData(officer, id)),
    source: 'PLATFORM',
  });
}
