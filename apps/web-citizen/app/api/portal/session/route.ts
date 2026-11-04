import { validateOtpCode } from '@serviceform/m10-sample-lab/identity-rules';
import {
  clearSessionCookie,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionToken,
} from '../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OTP_FAILED =
  'The OTP is incorrect, has expired, or too many attempts were made. Check the code or request a new OTP.';

function summary(assurance: string) {
  return {
    authenticated: true,
    display_name: 'Verified citizen',
    masked_mobile: null,
    email: null,
    preferred_language: 'en',
    assurance,
    identity_source: 'CMP-004',
    simulation: true,
    g6_issued: false,
  };
}

export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(200, { authenticated: false, simulation: true, g6_issued: false });
  return json(200, summary(citizen.assurance));
}

/** CMP-004 `verifyCitizenOtp`; the cookie receives only the opaque session token. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = body?.['challenge_id'];
  const code = typeof body?.['code'] === 'string' ? body['code'] : '';
  const codeError = validateOtpCode(code);
  if (!isUuid(challengeId) || codeError) {
    return json(400, {
      error_code: 'SF-SYS-003',
      message: codeError ?? 'Request a new OTP',
      field: 'code',
    });
  }
  const res = await platform('POST', '/v1/identity/citizen/otp/verify', {
    body: { challenge_id: challengeId, code },
  });
  const token = res.body['session_token'];
  if (res.status === 401) {
    return json(401, { error_code: 'SF-AUTH-001', message: OTP_FAILED, field: 'code' });
  }
  if (res.status !== 200 || typeof token !== 'string') return relay(res);
  return json(201, summary('OTP'), {
    'set-cookie': sessionCookie(token, SESSION_MAX_AGE_SECONDS),
  });
}

/** CMP-004 `revokeCitizenSession`, then clear the cookie whatever the platform answers. */
export async function DELETE(request: Request) {
  const token = sessionToken(request);
  if (token) await platform('POST', '/v1/identity/citizen/sessions/revoke', { token, body: {} });
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
}
