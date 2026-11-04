import {
  readWorkingData,
  toWorkbenchApplication,
  type PlatformApplication,
} from '../../../../lib/portal/cases';
import { currentOfficer, json, platform, relay } from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tenant queue from CMP-015 (role path in OPA; RLS tenant from the officer's CMP-004 session). */
export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const res = await platform('GET', '/v1/applications?limit=100', { token: officer.token });
  if (res.status !== 200) return relay(res);
  const apps = ((res.body['applications'] ?? []) as PlatformApplication[]).filter(
    (a) => !['DRAFT', 'READY_TO_SUBMIT'].includes(a.state),
  );
  const applications = await Promise.all(
    apps.map(async (a) =>
      toWorkbenchApplication(a, await readWorkingData(officer, a.application_id)),
    ),
  );
  return json(200, { source: 'PLATFORM', g6_issued: false, applications });
}
