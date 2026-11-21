import { crossSiteRefusal, currentOfficer, json, platform, relay } from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Published SAMPLE_LAB appointment types + slot templates (CMP-056 lab catalogue). */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('GET', '/v1/lab/appointments/catalogue', {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  return json(200, res.body);
}

/** Ensure opaque types + capacity slots are seeded from catalogue metadata. */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('POST', '/v1/lab/appointments/ensure', {
    token: officer.token,
    from: request,
    idempotent: true,
  });
  if (res.status !== 200) return relay(res);
  return json(200, res.body);
}
