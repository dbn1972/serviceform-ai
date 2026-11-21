import { json, platform, currentOfficer, relay } from '../../../../../lib/portal/platform';
import {
  SAMPLE_LAB_ASSISTED_CHANNELS,
  SAMPLE_LAB_ASSISTED_CONSENT,
  SAMPLE_LAB_ASSISTED_ASSURANCE,
} from '../../../../../lib/portal/assisted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SAMPLE_LAB assisted catalogue — channels + consent purpose (Constitution #36). */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('GET', '/v1/lab/assisted/catalogue', {
    token: officer.token,
    from: request,
  });
  if (res.status === 200) {
    return json(200, {
      ...res.body,
      certified: false,
      g6_issued: false,
    });
  }
  // Platform mount optional in some lab boots — fall back to published package catalogue.
  if (res.status === 404 || res.status === 503) {
    return json(200, {
      source: 'SAMPLE_LAB_PACKAGE',
      g6_issued: false,
      certified: false,
      constitution: 36,
      impersonation_forbidden: true,
      catalogue: {
        default_channel: 'CSC',
        channels: SAMPLE_LAB_ASSISTED_CHANNELS,
        consent: SAMPLE_LAB_ASSISTED_CONSENT,
        assurance: SAMPLE_LAB_ASSISTED_ASSURANCE,
        default_offering_catalogue_id: 'IND-SOC-002',
      },
    });
  }
  return relay(res);
}
