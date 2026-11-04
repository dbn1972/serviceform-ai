import {
  toPortalApplication,
  type PlatformApplication,
} from '../../../../../lib/portal/applications';
import { readWorkingData } from '../../../../../lib/portal/cases';
import { currentCitizen, isUuid, json, platform, relay } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** One application, if CMP-015/OPA allow this citizen to read it. */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  const res = await platform('GET', `/v1/applications/${id}`, { token: citizen.token });
  const app = res.body['application'] as PlatformApplication | undefined;
  if (res.status === 403 || res.status === 404) {
    return json(404, { error_code: 'SF-SYS-002', message: 'We could not find this application.' });
  }
  if (res.status !== 200 || !app) return relay(res);
  return json(200, {
    application: toPortalApplication(app, await readWorkingData(citizen, id)),
    source: 'PLATFORM',
    g6_issued: false,
  });
}
