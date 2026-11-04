'use client';

import { Button, Icon, TextInput } from '@serviceform/ui-ux4g';
import {
  LAB_OTP_LENGTH,
  normaliseMobile,
  validateMobile,
} from '@serviceform/m10-sample-lab/identity-rules';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  postJson,
  requestOtp,
  safeNext,
  type ApiError,
  type OtpChallenge,
  type SessionSummary,
} from '../../lib/auth-client';
import { FormAlert } from '../FormFeedback';
import { OtpVerifyStep, type VerifyOutcome } from './OtpVerifyStep';
import { SignedInPanel } from './SignedInPanel';
import { useCitizenSession } from '../../lib/use-citizen-session';

const MOBILE_ID = 'signin-mobile';

export type AuthFlowProps = {
  /** Raw `next` query value; validated with `safeNext`. */
  nextParam?: string | undefined;
  initialMobile?: string | undefined;
};

export type SignInFlowProps = AuthFlowProps & {
  signedOut?: boolean;
  /** Register uses the same CMP-004 OTP flow; the citizen principal is created on first verify. */
  mode?: 'sign-in' | 'register';
};

export function SignInFlow({
  nextParam,
  initialMobile = '',
  signedOut = false,
  mode = 'sign-in',
}: SignInFlowProps) {
  const registering = mode === 'register';
  const router = useRouter();
  const next = safeNext(nextParam);
  const nextQuery = nextParam ? `next=${encodeURIComponent(next)}` : '';
  const session = useCitizenSession();
  const [mobile, setMobile] = useState(() => normaliseMobile(initialMobile).slice(0, 10));
  const [mobileError, setMobileError] = useState<string>();
  const [notice, setNotice] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [resent, setResent] = useState(false);

  async function sendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateMobile(mobile);
    if (invalid) {
      setMobileError(invalid);
      document.getElementById(MOBILE_ID)?.focus();
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await requestOtp(mobile, 'SIGN_IN');
    setBusy(false);
    if (!res.ok) {
      if (res.error.field === 'mobile') setMobileError(res.error.message);
      else setNotice(res.error);
      return;
    }
    setResent(false);
    setChallenge(res.data);
  }

  async function verify(code: string): Promise<VerifyOutcome> {
    if (!challenge)
      return {
        ok: false,
        error: { status: 0, error_code: 'SF-SYS-003', message: 'Request a new OTP' },
      };
    const res = await postJson<SessionSummary>('/api/portal/session', {
      challenge_id: challenge.challenge_id,
      code,
    });
    if (res.ok) {
      router.push(next);
      router.refresh();
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }

  async function resend(): Promise<ApiError | null> {
    const res = await requestOtp(mobile, 'SIGN_IN');
    if (!res.ok) return res.error;
    setChallenge(res.data);
    setResent(true);
    return null;
  }

  if (session.status === 'signed-in' && !challenge) {
    return (
      <SignedInPanel name={session.profile.display_name} next={next} onSignOut={session.signOut} />
    );
  }

  if (challenge) {
    return (
      <OtpVerifyStep
        key={challenge.challenge_id}
        idPrefix="signin"
        challenge={challenge}
        eyebrow={
          <>
            <Icon name="lock" size={16} />
            {registering ? 'Create your account' : 'Secure sign in'}
          </>
        }
        title="Enter the OTP"
        submitLabel={registering ? 'Verify and create account' : 'Verify and sign in'}
        busyLabel="Verifying…"
        successLabel="Verified. Signing you in…"
        backLabel="Change mobile number"
        notice={
          resent ? (
            <FormAlert tone="success">
              A new OTP has been sent to {challenge.masked_mobile}.
            </FormAlert>
          ) : null
        }
        onBack={() => {
          setChallenge(null);
          requestAnimationFrame(() => document.getElementById(MOBILE_ID)?.focus());
        }}
        onVerify={verify}
        onResend={resend}
      />
    );
  }

  return (
    <>
      <header className="sf-auth-head">
        <p className="sf-auth-eyebrow ux4g-label-s-strong">
          <Icon name="user" size={16} />
          {registering ? 'New citizen account' : 'Citizen sign in'}
        </p>
        <h1 className="ux4g-heading-xl-strong">
          {registering ? 'Create your account' : 'Sign in to your account'}
        </h1>
        <p className="ux4g-body-m-default">
          {registering
            ? 'Verify your mobile number to create your citizen account. '
            : 'Enter the mobile number linked to your citizen account. '}
          We will send you a {LAB_OTP_LENGTH}-digit one-time password (OTP) — there is no password
          to remember.
        </p>
      </header>
      {signedOut && !notice ? (
        <FormAlert tone="success" testId="signed-out-notice">
          You have signed out. Sign in again to continue.
        </FormAlert>
      ) : null}
      {notice ? <FormAlert tone="error">{notice.message}</FormAlert> : null}
      <form className="sf-auth-form" noValidate onSubmit={(e) => void sendOtp(e)}>
        <TextInput
          id={MOBILE_ID}
          name="mobile"
          label="Mobile number"
          size="l"
          prefix="+91"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile number"
          value={mobile}
          onChange={(e) => {
            setMobile(normaliseMobile(e.target.value).slice(0, 10));
            if (mobileError) setMobileError(undefined);
          }}
          hint="We will send the OTP to this number by SMS."
          error={mobileError}
        />
        <div className="sf-auth-actions">
          <Button type="submit" size="l" disabled={busy}>
            {busy ? 'Sending OTP…' : 'Get OTP'}
            {busy ? null : <Icon name="arrow-right" size={18} />}
          </Button>
        </div>
      </form>
      <div className="ux4g-divider-horizontal-text sf-auth-divider">
        <span className="ux4g-divider-text">
          {registering ? 'Already have an account?' : 'New to the Citizen Portal?'}
        </span>
      </div>
      <div className="sf-auth-actions">
        <Link
          className="ux4g-btn-outline-neutral ux4g-btn-l"
          href={`${registering ? '/login' : '/register'}${nextQuery ? `?${nextQuery}` : ''}`}
        >
          {registering ? 'Sign in' : 'Create an account'}
        </Link>
      </div>
      <p className="sf-auth-privacy">
        <Icon name="lock" size={16} />
        <span>
          Your mobile number is used only to verify your identity and to send updates about your
          applications.
        </span>
      </p>
    </>
  );
}
