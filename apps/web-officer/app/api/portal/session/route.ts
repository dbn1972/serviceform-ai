import {
  currentOfficer,
  json,
  platform,
  relay,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionToken,
  simulationAllowed,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const officer = await currentOfficer(request);
  if (!officer) return json(200, { authenticated: false, simulation: true, g6_issued: false });
  return json(200, {
    authenticated: true,
    identity_source: 'CMP-004',
    simulation: true,
    g6_issued: false,
  });
}

/** SIMULATED IdP assertion → CMP-004 `issueOfficerSession`; the cookie gets only the token. */
export async function POST(request: Request) {
  if (!simulationAllowed()) {
    return json(404, { error_code: 'SF-SYS-002', message: 'Not found' });
  }
  const body = (await request.json().catch(() => null)) as { subject?: unknown } | null;
  if (typeof body?.subject !== 'string' || body.subject.length > 80) {
    return json(400, { error_code: 'SF-SYS-003', message: 'Choose an officer' });
  }
  const assertion = await platform('POST', '/v1/simulated/idp/assertions', {
    body: { subject: body.subject },
  });
  if (assertion.status !== 200 || typeof assertion.body['assertion'] !== 'string') {
    return relay(assertion);
  }
  const session = await platform('POST', '/v1/identity/officer/sessions', {
    body: { assertion: assertion.body['assertion'] },
    idempotent: true,
  });
  const token = session.body['session_token'];
  if (session.status !== 200 || typeof token !== 'string') return relay(session);
  return json(
    201,
    {
      authenticated: true,
      display_name: assertion.body['display_name'] ?? 'Officer',
      simulation: true,
    },
    { 'set-cookie': sessionCookie(token, SESSION_MAX_AGE_SECONDS) },
  );
}

export async function DELETE(request: Request) {
  const token = sessionToken(request);
  if (token) await platform('POST', '/v1/identity/officer/sessions/revoke', { token, body: {} });
  return new Response(null, { status: 204, headers: { 'set-cookie': sessionCookie('', 0) } });
}
