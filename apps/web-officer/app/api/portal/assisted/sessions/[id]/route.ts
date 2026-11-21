import {
  json,
  platform,
  currentOfficer,
  relay,
  isUuid,
} from '../../../../../../lib/portal/platform';
import { toAssistedSessionView } from '../../../../../../lib/portal/assisted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'session_id must be a UUID' });
  }
  const res = await platform('GET', `/v1/assisted/sessions/${id}`, {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const view = toAssistedSessionView(res.body);
  return json(200, {
    ...res.body,
    portal: view,
    certified: false,
    g6_issued: false,
  });
}
