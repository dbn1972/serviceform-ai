import {
  crossSiteRefusal,
  currentOfficer,
  json,
  platform,
  relay,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Published SAMPLE_LAB inspection pins + result codes (CMP-018 lab catalogue). */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('GET', '/v1/lab/inspections/catalogue', {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    catalogue: res.body['catalogue'],
  });
}

/** Guard unused POST against CSRF noise. */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  return json(405, { error_code: 'SF-SYS-003', message: 'Method not allowed' });
}
