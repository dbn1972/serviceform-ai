import {
  SAMPLE_LAB_GRIEVANCE_CATEGORIES,
  SAMPLE_LAB_GRIEVANCE_ROUTING,
} from '@serviceform/m10-sample-lab';
import {
  parseCategory,
  toPortalGrievance,
  type PlatformGrievance,
} from '../../../../lib/portal/grievances';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

/** Citizen grievance list (lab list route → CMP-027). */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const res = await platform('GET', '/v1/lab/grievances/mine?limit=50', {
    token: citizen.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const rows = (res.body['grievances'] ?? []) as PlatformGrievance[];
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    categories: SAMPLE_LAB_GRIEVANCE_CATEGORIES,
    grievances: rows.map(toPortalGrievance),
  });
}

/**
 * Raise grievance linked to an application (opaque id).
 * Files via CMP-027 then citizen CATEGORISE with published category code.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const applicationId =
    typeof body?.['application_id'] === 'string' && isUuid(body['application_id'])
      ? body['application_id']
      : null;
  const category = parseCategory(body?.['category_code']);
  if (!category) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Choose a published grievance category',
    });
  }
  if (!applicationId) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: 'Link the grievance to an application',
    });
  }

  const owned = await platform('GET', `/v1/applications/${applicationId}`, {
    token: citizen.token,
    from: request,
  });
  if (owned.status !== 200) {
    return json(403, {
      error_code: 'SF-AUTH-002',
      message: 'You can only raise a grievance on your own application',
    });
  }

  const file = await platform('POST', '/v1/grievances', {
    token: citizen.token,
    from: request,
    idempotent: true,
    body: {
      application_id: applicationId,
      organisation_id: SAMPLE_LAB_GRIEVANCE_ROUTING.organisation_id,
      jurisdiction_id: SAMPLE_LAB_GRIEVANCE_ROUTING.jurisdiction_id,
    },
  });
  const grievance = file.body['grievance'] as PlatformGrievance | undefined;
  if (file.status !== 201 || !grievance) return relay(file);

  const categorise = await platform('POST', `/v1/grievances/${grievance.grievance_id}/commands`, {
    token: citizen.token,
    from: request,
    idempotent: true,
    body: {
      command: 'CATEGORISE',
      expected_status: grievance.status,
      expected_version: grievance.aggregate_version,
      category_code: category,
    },
  });
  const next = categorise.body['grievance'] as PlatformGrievance | undefined;
  if (categorise.status !== 200 || !next) return relay(categorise);

  return json(201, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    grievance: toPortalGrievance(next),
  });
}
