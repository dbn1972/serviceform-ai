import { NextResponse } from 'next/server';
import {
  LAB_SESSION_TTL_SECONDS,
  maskMobile,
  type LabCitizenAccount,
  type LabOtpFailureReason,
} from '@serviceform/m10-sample-lab';
import { encodeCitizenSession, sessionForAccount, setCitizenCookie } from './lab-session';

/** Platform error envelope (contracts/shared error-catalogue codes) plus lab-only hints. */
export function labError(
  status: number,
  error_code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error_code, message, ...extra }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const OTP_FAILURE_COPY: Record<LabOtpFailureReason, string> = {
  INVALID_CODE: 'The OTP you entered is incorrect.',
  LOCKED: 'Too many incorrect attempts. Request a new OTP to continue.',
  EXPIRED: 'This OTP has expired. Request a new one to continue.',
  ALREADY_USED: 'This OTP has already been used. Request a new one to continue.',
  NOT_FOUND: 'This OTP is no longer valid. Request a new one to continue.',
  PURPOSE_MISMATCH: 'This OTP is no longer valid. Request a new one to continue.',
};

/** CMP-004 maps every OTP failure to SF-AUTH-001; `reason` lets the UI pick the right state. */
export function otpFailure(reason: LabOtpFailureReason, attempts_remaining: number): NextResponse {
  const base = OTP_FAILURE_COPY[reason];
  const message =
    reason === 'INVALID_CODE'
      ? `${base} ${attempts_remaining} ${attempts_remaining === 1 ? 'attempt' : 'attempts'} left.`
      : base;
  return labError(401, 'SF-AUTH-001', message, { reason, attempts_remaining });
}

export function sessionResponse(account: LabCitizenAccount, status = 201): NextResponse {
  const session = sessionForAccount(account);
  return new NextResponse(
    JSON.stringify({
      authenticated: true,
      display_name: session.display_name,
      masked_mobile: maskMobile(session.mobile),
      email: session.email ?? null,
      preferred_language: session.preferred_language,
      auth_assurance: session.auth_assurance,
      simulation: true,
      g6_issued: false,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'set-cookie': setCitizenCookie(encodeCitizenSession(session), LAB_SESSION_TTL_SECONDS),
      },
    },
  );
}
