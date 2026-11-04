import {
  checkResidenceForm,
  toPortalApplication,
  type PlatformApplication,
} from '../../../../lib/portal/applications';
import { command, readWorkingData } from '../../../../lib/portal/cases';
import {
  currentCitizen,
  json,
  offeringFor,
  platform,
  portalPlacement,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN_REQUIRED = 'Sign in with your mobile number to continue';

/** The signed-in citizen's applications: CMP-015 filters by owner in SQL under the portal tenant. */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const res = await platform('GET', '/v1/applications?limit=50', { token: citizen.token });
  if (res.status !== 200) return relay(res);
  const apps = (res.body['applications'] ?? []) as PlatformApplication[];
  const applications = await Promise.all(
    apps.map(async (a) => toPortalApplication(a, await readWorkingData(citizen, a.application_id))),
  );
  return json(200, { source: 'PLATFORM', g6_issued: false, applications });
}

/**
 * Apply: CMP-015 draft pinned to the placement's published binding, working data, then
 * MARK_READY_TO_SUBMIT and SUBMIT. Each step is OPA-authorized as the owning citizen.
 */
export async function POST(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN_REQUIRED });
  const checked = checkResidenceForm(
    await request.json().catch(() => null),
    portalPlacement().environment_label === 'SAMPLE_LAB',
  );
  if (!checked.ok) {
    return json(400, { error_code: 'SF-SYS-003', message: checked.message, field: checked.field });
  }
  const offering = offeringFor('IND-SOC-002');
  if (!offering)
    return json(404, { error_code: 'SF-SYS-002', message: 'Service not offered here' });

  const draft = await platform('POST', '/v1/applications', {
    token: citizen.token,
    idempotent: true,
    body: { tenant_service_binding_id: offering.tenant_service_binding_id },
  });
  let app = draft.body['application'] as PlatformApplication | undefined;
  if (draft.status !== 201 || !app) return relay(draft);

  const wd = await platform('PUT', `/v1/applications/${app.application_id}/working-data`, {
    token: citizen.token,
    idempotent: true,
    body: { form_version_id: app.pins.form_version_id, data: checked.form, expected_revision: 0 },
  });
  if (wd.status !== 200) return relay(wd);

  for (const step of ['MARK_READY_TO_SUBMIT', 'SUBMIT']) {
    const next = await command(citizen, app, step);
    if (!next.ok) return relay(next.res);
    app = next.app;
  }
  return json(201, {
    application: toPortalApplication(app, checked.form),
    source: 'PLATFORM',
    g6_issued: false,
  });
}
