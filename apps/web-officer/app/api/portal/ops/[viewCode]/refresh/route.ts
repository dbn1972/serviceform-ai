import { toOpsViewCard, type PlatformOpsView } from '../../../../../../lib/portal/ops';
import {
  crossSiteRefusal,
  currentOfficer,
  json,
  platform,
  relay,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ viewCode: string }> };

const VIEW = /^[A-Z][A-Z0-9_]{1,63}$/;

/** CMP-046 refresh — re-reads owner ports into derived snapshot. */
export async function POST(request: Request, ctx: Ctx) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { viewCode } = await ctx.params;
  if (!VIEW.test(viewCode)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'view_code required' });
  }
  const res = await platform('POST', `/v1/ops/views/${viewCode}/refresh`, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: {},
  });
  if (res.status !== 200 && res.status !== 201) return relay(res);
  const view = (res.body['view'] ?? res.body) as PlatformOpsView;
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    non_authoritative: true,
    view: toOpsViewCard(view),
  });
}
