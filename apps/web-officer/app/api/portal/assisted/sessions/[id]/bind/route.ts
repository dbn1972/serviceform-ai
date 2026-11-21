import {
  json,
  platform,
  currentOfficer,
  relay,
  crossSiteRefusal,
  isUuid,
} from '../../../../../../../lib/portal/platform';
import { SAMPLE_LAB_ASSISTED_ASSURANCE } from '../../../../../../../lib/portal/assisted';

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
  const expectedVersion =
    typeof body?.['expected_version'] === 'number' ? body['expected_version'] : null;
  if (expectedVersion === null) {
    return json(400, { error_code: 'SF-SYS-003', message: 'expected_version required' });
  }
  const assurance =
    typeof body?.['applicant_assurance_ref'] === 'string'
      ? body['applicant_assurance_ref']
      : SAMPLE_LAB_ASSISTED_ASSURANCE.default_ref;
  const res = await platform('POST', `/v1/assisted/sessions/${id}/applicant`, {
    token: officer.token,
    from: request,
    idempotent: true,
    body: { expected_version: expectedVersion, applicant_assurance_ref: assurance },
  });
  if (res.status !== 200) return relay(res);
  return json(200, { ...res.body, certified: false, g6_issued: false });
}
