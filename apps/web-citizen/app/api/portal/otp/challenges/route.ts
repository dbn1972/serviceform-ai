import {
  LAB_OTP_MAX_ATTEMPTS,
  LAB_OTP_RESEND_AFTER_SECONDS,
  LAB_OTP_TTL_SECONDS,
  maskMobile,
  normaliseMobile,
  validateMobile,
} from '@serviceform/m10-sample-lab/identity-rules';
import {
  isUuid,
  json,
  platform,
  relay,
  simulationAllowed,
} from '../../../../../lib/portal/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CMP-004 `requestCitizenOtp`. The response is identical for registered and new numbers. In
 * LOCAL/CI placements the SIMULATED SMS is read from the host's OTP inbox by challenge id.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { mobile?: unknown } | null;
  const mobile = normaliseMobile(typeof body?.mobile === 'string' ? body.mobile : '');
  const invalid = validateMobile(mobile);
  if (invalid) {
    return json(400, { error_code: 'SF-SYS-003', message: invalid, field: 'mobile' });
  }
  const res = await platform('POST', '/v1/identity/citizen/otp/challenges', {
    body: { channel: `+91${mobile}` },
    idempotent: true,
  });
  const challengeId = res.body['challenge_id'];
  if (res.status !== 200 || !isUuid(challengeId)) return relay(res);
  const to = maskMobile(mobile);
  const out: Record<string, unknown> = {
    challenge_id: challengeId,
    purpose: 'SIGN_IN',
    masked_mobile: to,
    expires_at: res.body['expires_at'],
    resend_after: new Date(Date.now() + LAB_OTP_RESEND_AFTER_SECONDS * 1000).toISOString(),
    max_attempts: LAB_OTP_MAX_ATTEMPTS,
    simulation: res.body['simulation'],
  };
  if (simulationAllowed()) {
    const inbox = await platform('GET', `/v1/simulated/otp-inbox/${challengeId}`);
    const code = inbox.body['code'];
    if (inbox.status === 200 && typeof code === 'string') {
      out['simulated_sms'] = {
        to,
        code,
        body: `${code} is your Citizen Portal one-time password. It is valid for ${LAB_OTP_TTL_SECONDS / 60} minutes. Do not share it with anyone.`,
      };
    }
  }
  return json(201, out);
}
