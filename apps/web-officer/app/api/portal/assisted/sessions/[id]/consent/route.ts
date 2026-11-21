import {
  json,
  platform,
  currentOfficer,
  relay,
  crossSiteRefusal,
  isUuid,
} from '../../../../../../../lib/portal/platform';
import {
  SAMPLE_LAB_ASSISTED_CONSENT,
  consentGate,
  toAssistedSessionView,
} from '../../../../../../../lib/portal/assisted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fail-closed lab consent capture. Must succeed before VERIFY_REPRESENTATION.
 * Operator stays applied_by; citizen stays applied_for.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const consentRef =
    typeof body?.['consent_ref'] === 'string'
      ? body['consent_ref']
      : `${SAMPLE_LAB_ASSISTED_CONSENT.consent_ref_prefix}/${id.slice(0, 8)}`;
  const gate = consentGate({
    read_back_acknowledged: body?.['read_back_acknowledged'],
    consent_ref: consentRef,
    applied_by_actor_id: view.applied_by_actor_id,
    applied_for_citizen_id: view.applied_for_citizen_id,
  });
  if (!gate.ok) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: gate.message,
      details: [{ code: gate.code }],
      certified: false,
      g6_issued: false,
    });
  }
  const res = await platform('POST', `/v1/lab/assisted/sessions/${id}/consent`, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: {
      consent_ref: gate.consent_ref,
      read_back_acknowledged: true,
    },
  });
  if (res.status !== 200) return relay(res);
  return json(200, { ...res.body, certified: false, g6_issued: false });
}
