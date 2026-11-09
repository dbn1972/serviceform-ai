import {
  maskMobile,
  validateLabRegistration,
  validateOtpCode,
} from '@serviceform/m10-sample-lab/identity-rules';
import {
  citizenForToken,
  clearSessionCookie,
  currentCitizen,
  isUuid,
  json,
  platform,
  relay,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionToken,
  crossSiteRefusal,
} from '../../../../lib/portal/platform';
import {
  readProfile,
  registerProfile,
  type ProfileClaims,
  type RegistrationResult,
} from '../../../../lib/portal/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OTP_FAILED =
  'The OTP is incorrect, has expired, or too many attempts were made. Check the code or request a new OTP.';
/** Shown until the citizen has a consented CMP-005 profile; never a person's name. */
const NO_PROFILE_NAME = 'Citizen';

function summary(assurance: string, profile: ProfileClaims | null) {
  return {
    authenticated: true,
    display_name: profile?.display_name ?? NO_PROFILE_NAME,
    masked_mobile: profile?.mobile ? maskMobile(profile.mobile) : null,
    email: null,
    preferred_language: 'en',
    assurance,
    identity_source: 'CMP-004',
    profile_source: profile?.display_name ? 'CMP-005' : null,
    simulation: true,
    g6_issued: false,
  };
}

/** CMP-004 identity per request; display name and mobile from the consented CMP-005 profile. */
export async function GET(request: Request) {
  const citizen = await currentCitizen(request);
  if (!citizen) return json(200, { authenticated: false, simulation: true, g6_issued: false });
  return json(200, summary(citizen.assurance, await readProfile(citizen)));
}

type Registration = { display_name: string; mobile: string; consent: boolean };

function registrationOf(raw: unknown): Registration | null | 'invalid' {
  if (raw === undefined) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'invalid';
  const r = raw as Record<string, unknown>;
  return {
    display_name: typeof r['display_name'] === 'string' ? r['display_name'].trim() : '',
    mobile: typeof r['mobile'] === 'string' ? r['mobile'] : '',
    consent: r['consent'] === true,
  };
}

const REGISTRATION_FAILED: Record<Exclude<RegistrationResult, { ok: true }>['step'], string> = {
  PROFILE: 'We could not create your citizen profile.',
  PURPOSE: 'Profile consent is not available in this portal.',
  CONSENT: 'We could not record your consent.',
  CLAIMS: 'We could not save your profile details.',
};

/**
 * CMP-004 `verifyCitizenOtp`; the cookie receives only the opaque session token. With a
 * `registration` the verified citizen's CMP-005 profile and CMP-030 consent are created before the
 * cookie is set, so a failed registration leaves no half-registered session in the browser.
 */
export async function POST(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
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
  const registration = registrationOf(body?.['registration']);
  if (registration === 'invalid') {
    return json(400, { error_code: 'SF-SYS-003', message: 'Send the registration as an object' });
  }
  if (registration) {
    const errors = validateLabRegistration({ ...registration, preferred_language: 'en' });
    if (Object.keys(errors).length > 0) {
      return json(400, {
        error_code: 'SF-SYS-003',
        message: 'Check your details',
        field_errors: errors,
      });
    }
  }
  const res = await platform('POST', '/v1/identity/citizen/otp/verify', {
    body: { challenge_id: challengeId, code },
  });
  const token = res.body['session_token'];
  if (res.status === 401) {
    return json(401, { error_code: 'SF-AUTH-001', message: OTP_FAILED, field: 'code' });
  }
  if (res.status !== 200 || typeof token !== 'string') return relay(res);

  const citizen = await citizenForToken(token);
  if (!citizen) return json(503, { error_code: 'SF-SYS-004', message: 'Sign in again shortly' });
  if (registration) {
    const saved = await registerProfile(citizen, registration);
    if (!saved.ok) {
      await platform('POST', '/v1/identity/citizen/sessions/revoke', { token, body: {} });
      return json(saved.status === 503 ? 503 : 502, {
        error_code: 'SF-SYS-004',
        message: `${REGISTRATION_FAILED[saved.step]} Request a new OTP and try again.`,
      });
    }
  }
  return json(201, summary('OTP', await readProfile(citizen)), {
    'set-cookie': sessionCookie(token, SESSION_MAX_AGE_SECONDS),
  });
}

/** CMP-004 `revokeCitizenSession`, then clear the cookie whatever the platform answers. */
export async function DELETE(request: Request) {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  const token = sessionToken(request);
  if (token) await platform('POST', '/v1/identity/citizen/sessions/revoke', { token, body: {} });
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
}
