import {
  labAssignment,
  simulatedBodyRef,
  toHelpdeskTicket,
  type PlatformGrievance,
} from '../../../../../lib/portal/grievances';
import {
  crossSiteRefusal,
  currentOfficer,
  isUuid,
  json,
  platform,
  relay,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid grievance id' });
  const res = await platform('GET', `/v1/grievances/${id}`, {
    token: officer.token,
    from: request,
  });
  if (res.status !== 200) return relay(res);
  const g = res.body['grievance'] as PlatformGrievance;
  const [transitions, responses] = await Promise.all([
    platform('GET', `/v1/grievances/${id}/transitions`, { token: officer.token, from: request }),
    platform('GET', `/v1/grievances/${id}/responses`, { token: officer.token, from: request }),
  ]);
  return json(200, {
    source: 'PLATFORM',
    g6_issued: false,
    certified: false,
    grievance: toHelpdeskTicket(g),
    transitions: transitions.status === 200 ? transitions.body['transitions'] : [],
    responses: responses.status === 200 ? responses.body['responses'] : [],
  });
}

/** Helpdesk commands: ROUTE, ASSIGN (L1), RESPOND, RESOLVE, CLOSE, ESCALATE. */
export async function POST(request: Request, { params }: Params) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const officer = await currentOfficer(request);
  if (!officer) return json(401, { error_code: 'SF-AUTH-001', message: 'Sign in to continue' });
  const { id } = await params;
  if (!isUuid(id)) return json(400, { error_code: 'SF-SYS-003', message: 'Invalid grievance id' });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.['action'];
  const token = officer.token;
  const current = await platform('GET', `/v1/grievances/${id}`, {
    token,
    from: request,
  });
  if (current.status !== 200) return relay(current);
  let g = current.body['grievance'] as PlatformGrievance;
  const note = typeof body?.['note'] === 'string' ? body['note'] : '';

  async function command(payload: Record<string, unknown>) {
    const res = await platform('POST', `/v1/grievances/${id}/commands`, {
      token,
      from: request,
      idempotent: true,
      body: {
        expected_status: g.status,
        expected_version: g.aggregate_version,
        ...payload,
      },
    });
    if (res.status !== 200) return res;
    g = res.body['grievance'] as PlatformGrievance;
    return res;
  }

  if (action === 'ROUTE') {
    const res = await command({ command: 'ROUTE' });
    if (res.status !== 200) return relay(res);
    return json(200, { grievance: toHelpdeskTicket(g), g6_issued: false });
  }

  if (action === 'ASSIGN') {
    const assignment = labAssignment(1);
    if (!assignment) {
      return json(400, { error_code: 'SF-SYS-003', message: 'Escalation metadata missing L1' });
    }
    const res = await command({ command: 'REQUEST_ASSIGNMENT', assignment });
    if (res.status !== 200) return relay(res);
    return json(200, {
      grievance: toHelpdeskTicket(g, assignment.role_code),
      g6_issued: false,
    });
  }

  if (action === 'RESPOND') {
    const res = await command({
      command: 'RECORD_RESPONSE',
      body_ref: simulatedBodyRef(note || 'OFFICER_REPLY'),
      reason_code: 'OFFICER_REPLY',
    });
    if (res.status !== 200) return relay(res);
    return json(200, { grievance: toHelpdeskTicket(g), g6_issued: false });
  }

  if (action === 'RESOLVE') {
    const res = await command({ command: 'RESOLVE', reason_code: 'HELPDESK_RESOLVED' });
    if (res.status !== 200) return relay(res);
    return json(200, { grievance: toHelpdeskTicket(g), g6_issued: false });
  }

  if (action === 'CLOSE') {
    const res = await command({ command: 'CLOSE', reason_code: 'HELPDESK_CLOSED' });
    if (res.status !== 200) return relay(res);
    return json(200, { grievance: toHelpdeskTicket(g), g6_issued: false });
  }

  if (action === 'ESCALATE') {
    const level =
      typeof body?.['level'] === 'number'
        ? body['level']
        : typeof body?.['level'] === 'string'
          ? Number(body['level'])
          : NaN;
    const assignment = labAssignment(level);
    if (!assignment) {
      return json(400, {
        error_code: 'SF-SYS-003',
        message: 'Escalation level not allowed by published metadata',
      });
    }
    const res = await command({
      command: 'ESCALATE',
      assignment,
      reason_code: `ESCALATE_L${level}`,
    });
    if (res.status !== 200) return relay(res);
    return json(200, {
      grievance: toHelpdeskTicket(g, assignment.role_code),
      g6_issued: false,
    });
  }

  return json(400, { error_code: 'SF-SYS-003', message: 'Unknown helpdesk action' });
}
