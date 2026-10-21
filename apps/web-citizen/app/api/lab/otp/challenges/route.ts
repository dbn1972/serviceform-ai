import { NextResponse } from 'next/server';
import {
  LAB_OTP_TTL_SECONDS,
  maskMobile,
  requestLabOtp,
  type LabOtpPurpose,
} from '@serviceform/m10-sample-lab';
import { asString, labError, readJsonBody } from '../../../../../lib/lab-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PURPOSES: readonly LabOtpPurpose[] = ['SIGN_IN', 'REGISTER'];

/** SAMPLE_LAB stand-in for CMP-004 `requestCitizenOtp` with a SIMULATED SMS adapter. */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const purpose = PURPOSES.find((p) => p === body?.['purpose']);
  if (!body || !purpose) {
    return labError(400, 'SF-SYS-003', 'mobile and purpose (SIGN_IN or REGISTER) are required');
  }
  const result = requestLabOtp({ mobile: asString(body['mobile']), purpose });
  if (!result.ok) {
    return labError(400, 'SF-LAB-SESSION-MOBILE', result.message, { field: 'mobile' });
  }
  const { challenge, simulated_code } = result;
  const to = maskMobile(challenge.mobile);
  return NextResponse.json(
    {
      challenge_id: challenge.challenge_id,
      purpose: challenge.purpose,
      masked_mobile: to,
      expires_at: challenge.expires_at,
      resend_after: challenge.resend_after,
      max_attempts: challenge.max_attempts,
      simulation: challenge.simulation,
      simulated_sms: {
        to,
        code: simulated_code,
        body: `${simulated_code} is your Citizen Portal one-time password. It is valid for ${LAB_OTP_TTL_SECONDS / 60} minutes. Do not share it with anyone.`,
      },
    },
    { status: 201 },
  );
}
