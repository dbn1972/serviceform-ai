'use client';

import { Button, Icon, OtpInput, type OtpState } from '@serviceform/ui-ux4g';
import { LAB_OTP_LENGTH, validateOtpCode } from '@serviceform/m10-sample-lab/identity-rules';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  formatCountdown,
  secondsUntil,
  type ApiError,
  type OtpChallenge,
} from '../../lib/auth-client';
import { FormAlert } from './FormFeedback';
import { SimulatedSms } from './SimulatedSms';

export type VerifyOutcome = { ok: true } | { ok: false; error: ApiError };

export type OtpVerifyStepProps = {
  idPrefix: string;
  challenge: OtpChallenge;
  eyebrow?: ReactNode;
  title: string;
  submitLabel: string;
  busyLabel: string;
  successLabel: string;
  backLabel: string;
  notice?: ReactNode;
  onBack: () => void;
  onVerify: (code: string) => Promise<VerifyOutcome>;
  /** Requests a fresh challenge; the parent re-keys this step with it. */
  onResend: () => Promise<ApiError | null>;
};

const TERMINAL_REASONS = new Set([
  'LOCKED',
  'EXPIRED',
  'ALREADY_USED',
  'NOT_FOUND',
  'PURPOSE_MISMATCH',
]);
const EXPIRED_MESSAGE = 'This OTP has expired. Request a new one to continue.';
const VERIFIED_MESSAGE = 'Mobile number verified.';
/** Account not found (sign in) / already exists (register): returned only after a valid OTP. */
const POST_VERIFY_STATUSES = new Set([404, 409]);

export function OtpVerifyStep({
  idPrefix,
  challenge,
  eyebrow,
  title,
  submitLabel,
  busyLabel,
  successLabel,
  backLabel,
  notice,
  onBack,
  onVerify,
  onResend,
}: OtpVerifyStepProps) {
  const otpId = `${idPrefix}-otp`;
  const [code, setCode] = useState('');
  const [state, setState] = useState<OtpState>('default');
  const [message, setMessage] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [blocking, setBlocking] = useState<ApiError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresIn = secondsUntil(challenge.expires_at, now);
  const resendIn = secondsUntil(challenge.resend_after, now);
  const expired = expiresIn === 0 && state !== 'success';
  const shownState: OtpState = expired && state !== 'locked' ? 'locked' : state;
  const shownMessage = expired && state !== 'locked' ? EXPIRED_MESSAGE : message;
  const inert = busy || shownState === 'locked' || state === 'success';

  const fail = (next: OtpState, text: string) => {
    setState(next);
    setMessage(text);
    if (next === 'error') {
      setErrorKey((k) => k + 1);
      document.getElementById(otpId)?.focus();
    }
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inert) return;
    const invalid = validateOtpCode(code);
    if (invalid) {
      fail('error', invalid);
      return;
    }
    setBusy(true);
    setBlocking(null);
    const outcome = await onVerify(code.replace(/\s/g, ''));
    setBusy(false);
    if (outcome.ok) {
      setState('success');
      setMessage(successLabel);
      return;
    }
    const { error } = outcome;
    if (error.reason === 'INVALID_CODE' || error.field === 'code') {
      fail('error', error.message);
    } else if (error.reason && TERMINAL_REASONS.has(error.reason)) {
      fail('locked', error.message);
    } else {
      if (POST_VERIFY_STATUSES.has(error.status)) {
        // The OTP was consumed and possession of the number proven; only the follow-up failed.
        setState('success');
        setMessage(VERIFIED_MESSAGE);
      }
      setBlocking(error);
    }
  }

  async function resend() {
    setResending(true);
    const error = await onResend();
    setResending(false);
    if (error) setBlocking(error);
  }

  return (
    <>
      <button type="button" className="sf-auth-back" onClick={onBack}>
        <Icon name="arrow-left" size={18} />
        {backLabel}
      </button>
      <header className="sf-auth-head">
        {eyebrow ? <p className="sf-auth-eyebrow ux4g-label-s-strong">{eyebrow}</p> : null}
        <h1 className="ux4g-heading-xl-strong">{title}</h1>
        <p className="ux4g-body-m-default">
          Enter the {LAB_OTP_LENGTH}-digit code we sent by SMS to{' '}
          <strong>{challenge.masked_mobile}</strong>.
        </p>
      </header>
      {notice}
      {challenge.simulated_sms ? <SimulatedSms sms={challenge.simulated_sms} /> : null}
      {blocking ? (
        <FormAlert
          tone={POST_VERIFY_STATUSES.has(blocking.status) ? 'warning' : 'error'}
          action={blocking.action}
          testId="otp-blocking-error"
        >
          {blocking.message}
        </FormAlert>
      ) : null}
      <form className="sf-auth-form" noValidate onSubmit={(e) => void submit(e)}>
        <OtpInput
          id={otpId}
          label="One-time password (OTP)"
          length={LAB_OTP_LENGTH}
          value={code}
          onChange={(next) => {
            setCode(next);
            if (state === 'error') {
              setState('default');
              setMessage('');
            }
          }}
          state={shownState}
          status={shownMessage}
          errorKey={errorKey}
          autoFocus
          disabled={state === 'success'}
          meta={
            state === 'success' ? undefined : (
              <>
                <span className="sf-auth-timer">
                  <Icon name="clock" size={16} />
                  {expiresIn > 0 ? `Code expires in ${formatCountdown(expiresIn)}` : 'Code expired'}
                </span>
                {resendIn > 0 ? (
                  <span className="ux4g-otp-helper">Resend OTP in {formatCountdown(resendIn)}</span>
                ) : (
                  <button
                    type="button"
                    className="ux4g-btn-text-primary ux4g-btn-s"
                    onClick={() => void resend()}
                    disabled={resending}
                  >
                    <Icon name="refresh" size={16} />
                    {resending ? 'Sending…' : 'Resend OTP'}
                  </button>
                )}
              </>
            )
          }
        />
        <div className="sf-auth-actions">
          <Button type="submit" size="l" disabled={inert}>
            {busy ? busyLabel : submitLabel}
          </Button>
        </div>
      </form>
    </>
  );
}
