import {
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
  tenantIdentifyingRefusal,
} from '../../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * CMP-015 append-only transition trail for the case (ops audit depth).
 * Platform strips tenant_id and actor_id from each row. Fail-closed OPA · CERTIFIED=false.
 */
export async function GET(request: Request, ctx: Ctx) {
  const tenancy = tenantIdentifyingRefusal(request);
  if (tenancy) return tenancy;
  const { id } = await ctx.params;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  if (!isUuid(id)) return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  const res = await platform('GET', `/v1/applications/${id}/transitions`, {
    token: officer.token,
  });
  if (res.status !== 200) return relay(res);
  return json(200, {
    application_id: id,
    transitions: Array.isArray(res.body['transitions']) ? res.body['transitions'] : [],
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
  });
}
