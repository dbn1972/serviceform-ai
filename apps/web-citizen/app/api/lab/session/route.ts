import { NextResponse } from 'next/server';
import { findLabAccount, validateOtpCode, verifyLabOtp } from '@serviceform/m10-sample-lab';
import {
  asString,
  labError,
  otpFailure,
  readJsonBody,
  sessionResponse,
} from '../../../../lib/lab-api';
import {
  CITIZEN_LAB_COOKIE,
  cookieValue,
  parseCitizenSession,
  setCitizenCookie,
} from '../../../../lib/lab-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const session = parseCitizenSession(
    cookieValue(request.headers.get('cookie'), CITIZEN_LAB_COOKIE),
  );
  if (!session) {
    return NextResponse.json({ authenticated: false, g6_issued: false, simulation: true });
  }
  return NextResponse.json({ authenticated: true, ...session });
}

/** Sign in: verify a SIGN_IN OTP challenge, then resolve the synthetic account by mobile. */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const challenge_id = asString(body?.['challenge_id']);
  const code = asString(body?.['code']);
  const codeError = validateOtpCode(code);
  if (!challenge_id || codeError) {
    return labError(400, 'SF-SYS-003', codeError ?? 'challenge_id is required', { field: 'code' });
  }
  const verified = verifyLabOtp({ challenge_id, code, purpose: 'SIGN_IN' });
  if (!verified.ok) return otpFailure(verified.reason, verified.attempts_remaining);

  const account = findLabAccount(verified.challenge.mobile);
  if (!account) {
    // Disclosed only after the OTP proves possession of the number (no pre-OTP enumeration).
    return labError(
      404,
      'SF-LAB-ACCOUNT-NOT-FOUND',
      'There is no citizen account for this mobile number yet. Create an account to continue.',
    );
  }
  return sessionResponse(account);
}

export function DELETE() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'set-cookie': setCitizenCookie('', 0) },
  });
}
