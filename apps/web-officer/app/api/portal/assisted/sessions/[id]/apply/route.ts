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

/**
 * Assisted apply: create draft as applied_for (server-mediated) + link via CMP-057 submit.
 * Officer cookie is never swapped to the citizen (Constitution #36).
 */
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
  if (!view) {
    return json(502, { error_code: 'SF-SYS-001', message: 'Malformed assisted session' });
  }
  if (!view.can_apply) {
    return json(409, {
      error_code: 'SF-APP-001',
      message: 'Consent and representation must be verified before assisted apply',
      details: [{ code: 'CONSENT_OR_REPRESENTATION_REQUIRED' }],
      certified: false,
      g6_issued: false,
    });
  }
  if (view.applied_by_actor_id.toLowerCase() === view.applied_for_citizen_id.toLowerCase()) {
    return json(403, {
      error_code: 'SF-AUTH-002',
      message: 'applied_by must be distinct from applied_for (Constitution #36)',
      certified: false,
      g6_issued: false,
    });
  }
  const catalogueId =
    typeof body?.['catalogue_id'] === 'string' ? body['catalogue_id'] : 'IND-SOC-002';
  const res = await platform('POST', `/v1/lab/assisted/sessions/${id}/apply`, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: { catalogue_id: catalogueId },
  });
  if (res.status !== 201 && res.status !== 200) return relay(res);
  return json(res.status, { ...res.body, certified: false, g6_issued: false });
}
