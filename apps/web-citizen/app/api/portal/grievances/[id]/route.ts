import {
  simulatedBodyRef,
  toPortalGrievance,
  type PlatformGrievance,
} from '../../../../../lib/portal/grievances';
import {
  crossSiteRefusal,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGN_IN = 'Sign in with your mobile number to continue';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid grievance id' });
  const res = await platform('GET', `/v1/grievances/${id}`, {
    token: citizen.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const grievance = res.body['grievance'] as PlatformGrievance;
  const transitions = await platform('GET', `/v1/grievances/${id}/transitions`, {
    token: citizen.token,
    from: request,
  });
  const responses = await platform('GET', `/v1/grievances/${id}/responses`, {
    token: citizen.token,
    from: request,
  });
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    grievance: toPortalGrievance(grievance),
    transitions: transitions.status === 200 ? transitions.body['transitions'] : [],
    responses: responses.status === 200 ? responses.body['responses'] : [],
  });
}

/** Citizen WITHDRAW or RECORD_RESPONSE (including escalation request note). */
export async function POST(request: Request, { params }: Params) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const citizen = await currentCitizen(request);
  if (!citizen) return json(401, { error_code: 'SF-AUTH-001', message: SIGN_IN });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid grievance id' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.['action'];
  const current = await platform('GET', `/v1/grievances/${id}`, {
    token: citizen.token,
    from: request,
  });
  if (current.status !== 200) return relay(current);
  const g = current.body['grievance'] as PlatformGrievance;

  if (action === 'WITHDRAW') {
    const res = await platform('POST', `/v1/grievances/${id}/commands`, {
      token: citizen.token,
      from: request,
      idempotent: true,
      body: {
        command: 'WITHDRAW',
        expected_status: g.status,
        expected_version: g.aggregate_version,
      },
    });
    if (res.status !== 200) return relay(res);
    return json(200, {
      grievance: toPortalGrievance(res.body['grievance'] as PlatformGrievance),
      g6_issued: false,
    });
  }

  if (action === 'RESPOND' || action === 'REQUEST_ESCALATION') {
    const note = typeof body?.['note'] === 'string' ? body['note'] : '';
    const res = await platform('POST', `/v1/grievances/${id}/commands`, {
      token: citizen.token,
      from: request,
      idempotent: true,
      body: {
        command: 'RECORD_RESPONSE',
        expected_status: g.status,
        expected_version: g.aggregate_version,
        body_ref: simulatedBodyRef(note || action),
        reason_code: action === 'REQUEST_ESCALATION' ? 'REQUEST_ESCALATION' : 'CITIZEN_REPLY',
      },
    });
    if (res.status !== 200) return relay(res);
    return json(200, {
      grievance: toPortalGrievance(res.body['grievance'] as PlatformGrievance),
      g6_issued: false,
      note: 'Escalation is fulfilled by an officer when metadata allows; this records your request only.',
    });
  }

  return json(400, { error_code: 'SF-SYS-003', message: 'Unknown action' });
}
