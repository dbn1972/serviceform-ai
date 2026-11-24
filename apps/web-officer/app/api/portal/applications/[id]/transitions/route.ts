import { sanitizeAuditRow } from '../../../../../../lib/portal/audit-view';
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
 * Platform strips tenant_id and actor_id; BFF re-sanitizes as defence in depth (P8-5).
 * Fail-closed OPA · CERTIFIED=false · G6=false.
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
  const raw = Array.isArray(res.body['transitions']) ? res.body['transitions'] : [];
  const transitions = raw.map((row) =>
    sanitizeAuditRow(
      row && typeof row === 'object'
        ? (row as Record<string, unknown>)
        : ({} as Record<string, unknown>),
    ),
  );
  return json(200, {
    application_id: id,
    transitions,
    source: 'PLATFORM',
    certified: false,
    g6_issued: false,
    tsb_immutability_sealed: false,
  });
}
