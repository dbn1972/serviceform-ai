import {
  json,
  platform,
  currentOfficer,
  relay,
  crossSiteRefusal,
  isUuid,
} from '../../../../../../../lib/portal/platform';
import { toAssistedSessionView } from '../../../../../../../lib/portal/assisted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return json(400, { error_code: 'SF-SYS-003', message: 'session_id must be a UUID' });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const current = await platform('GET', `/v1/assisted/sessions/${id}`, {
    token: officer.token,
    from: request,
  });
  if (current.status !== 200) return relay(current);
  const view = toAssistedSessionView(current.body);
  const expectedVersion =
    typeof body?.['expected_version'] === 'number'
      ? body['expected_version']
      : (view?.session_version ?? 0);
  const res = await platform('POST', `/v1/assisted/sessions/${id}/close`, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: { expected_version: expectedVersion },
  });
  if (res.status !== 200) return relay(res);
  return json(200, { ...res.body, certified: false, g6_issued: false });
}
