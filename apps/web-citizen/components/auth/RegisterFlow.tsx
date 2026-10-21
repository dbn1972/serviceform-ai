'use client';

import { Button, Checkbox, Icon, RadioGroup, TextInput } from '@serviceform/ui-ux4g';
import {
  LAB_LANGUAGES,
  isLabLanguage,
  normaliseMobile,
  validateLabRegistration,
  type LabPreferredLanguage,
  type LabRegistrationField,
} from '@serviceform/m10-sample-lab/identity-rules';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  postJson,
  requestOtp,
  safeNext,
  type ApiError,
  type OtpChallenge,
  type SessionSummary,
} from '../../lib/auth-client';
import { ErrorSummary, FormAlert } from '../FormFeedback';
import { OtpVerifyStep, type VerifyOutcome } from './OtpVerifyStep';
import { SignedInPanel } from './SignedInPanel';
import { announceSessionChange, useCitizenSession } from '../../lib/use-citizen-session';
import type { AuthFlowProps } from './SignInFlow';

type Step = 'details' | 'otp' | 'done';
type Values = {
  display_name: string;
  mobile: string;
  email: string;
  preferred_language: LabPreferredLanguage;
  consent: boolean;
};
type FieldErrors = Partial<Record<LabRegistrationField, string>>;

const FIELD_IDS: Record<LabRegistrationField, string> = {
  display_name: 'reg-name',
  mobile: 'reg-mobile',
  email: 'reg-email',
  consent: 'reg-consent',
};
const FIELD_ORDER: readonly LabRegistrationField[] = ['display_name', 'mobile', 'email', 'consent'];
const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'details', label: 'Your details' },
  { id: 'otp', label: 'Verify mobile' },
  { id: 'done', label: 'Done' },
];
const LANGUAGE_NAMES: Record<LabPreferredLanguage, string> = { en: 'English', hi: 'हिन्दी' };
const DEFAULT_NEXT_SERVICE = '/services/IND-SOC-002/apply';

function Progress({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="sf-auth-progress" aria-label="Account creation progress">
      {STEPS.map((s, index) => (
        <li
          key={s.id}
          className={index < current ? 'sf-done' : undefined}
          aria-current={index === current ? 'step' : undefined}
        >
          <span>
            {index + 1}. {s.label}
            {index < current ? <span className="ux4g-sr-only"> (completed)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export type RegisterFlowProps = AuthFlowProps & {
  /** One-line facts about the featured service, shown on the success screen. */
  serviceSummary: string;
};

export function RegisterFlow({ nextParam, initialMobile = '', serviceSummary }: RegisterFlowProps) {
  const rawNext = nextParam;
  const next = safeNext(rawNext, DEFAULT_NEXT_SERVICE);
  const signInHref = `/login${rawNext ? `?next=${encodeURIComponent(next)}` : ''}`;
  const session = useCitizenSession();
  const [step, setStep] = useState<Step>('details');
  const [values, setValues] = useState<Values>(() => ({
    display_name: '',
    mobile: normaliseMobile(initialMobile).slice(0, 10),
    email: '',
    preferred_language: 'en',
    consent: false,
  }));
  const [touched, setTouched] = useState<Partial<Record<LabRegistrationField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [resent, setResent] = useState(false);
  const [account, setAccount] = useState<SessionSummary | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  const errors: FieldErrors = { ...validateLabRegistration(values), ...serverErrors };
  const visible = (field: LabRegistrationField) =>
    attempted || touched[field] ? errors[field] : undefined;
  const summaryItems = FIELD_ORDER.flatMap((field) => {
    const message = visible(field);
    return message ? [{ fieldId: FIELD_IDS[field], message }] : [];
  });

  useEffect(() => {
    if (step === 'done') doneHeadingRef.current?.focus();
  }, [step]);

  function set<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((v) => ({ ...v, [field]: value }));
    if (field in serverErrors) {
      setServerErrors((e) =>
        Object.fromEntries(Object.entries(e).filter(([key]) => key !== field)),
      );
    }
  }

  const touch = (field: LabRegistrationField) => () => {
    if (field === 'consent' || values[field]) setTouched((t) => ({ ...t, [field]: true }));
  };

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    setNotice(null);
    if (Object.keys(validateLabRegistration(values)).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setBusy(true);
    const res = await requestOtp(values.mobile, 'REGISTER');
    setBusy(false);
    if (!res.ok) {
      if (res.error.field === 'mobile') {
        setServerErrors({ mobile: res.error.message });
        requestAnimationFrame(() => summaryRef.current?.focus());
      } else {
        setNotice(res.error);
      }
      return;
    }
    setResent(false);
    setChallenge(res.data);
    setStep('otp');
  }

  async function verify(code: string): Promise<VerifyOutcome> {
    if (!challenge)
      return {
        ok: false,
        error: { status: 0, error_code: 'SF-SYS-003', message: 'Request a new OTP' },
      };
    const res = await postJson<SessionSummary>('/api/lab/accounts', {
      ...values,
      challenge_id: challenge.challenge_id,
      code,
    });
    if (res.ok) {
      setAccount(res.data);
      setStep('done');
      announceSessionChange();
      return { ok: true };
    }
    if (res.error.error_code === 'SF-LAB-ACCOUNT-EXISTS') {
      const query = [`mobile=${values.mobile}`, rawNext ? `next=${encodeURIComponent(next)}` : '']
        .filter(Boolean)
        .join('&');
      return {
        ok: false,
        error: { ...res.error, action: { href: `/login?${query}`, label: 'Sign in instead' } },
      };
    }
    if (res.error.field_errors) {
      setServerErrors(res.error.field_errors);
      setStep('details');
    }
    return { ok: false, error: res.error };
  }

  async function resend(): Promise<ApiError | null> {
    const res = await requestOtp(values.mobile, 'REGISTER');
    if (!res.ok) return res.error;
    setChallenge(res.data);
    setResent(true);
    return null;
  }

  if (session.status === 'signed-in' && step === 'details') {
    return (
      <SignedInPanel name={session.profile.display_name} next={next} onSignOut={session.signOut} />
    );
  }

  if (step === 'done' && account) {
    return (
      <>
        <Progress step="done" />
        <span className="sf-auth-success-mark">
          <Icon name="check" size={28} />
        </span>
        <header className="sf-auth-head">
          <p className="sf-auth-eyebrow ux4g-label-s-strong">Account created</p>
          <h1 ref={doneHeadingRef} tabIndex={-1} className="ux4g-heading-xl-strong">
            Your account is ready
          </h1>
          <p className="ux4g-body-m-default">
            Welcome, <strong>{account.display_name}</strong>. Your mobile number is verified and you
            are now signed in.
          </p>
        </header>
        <dl className="sf-dl sf-auth-summary" data-testid="account-summary">
          <dt>Name</dt>
          <dd>{account.display_name}</dd>
          <dt>Mobile</dt>
          <dd className="sf-auth-verified">
            <span>{account.masked_mobile}</span>
            <span className="ux4g-tag-tonal-success ux4g-tag-s">Verified</span>
          </dd>
          <dt>Email</dt>
          <dd>{account.email ?? 'Not provided'}</dd>
          <dt>Updates in</dt>
          <dd lang={account.preferred_language}>{LANGUAGE_NAMES[account.preferred_language]}</dd>
        </dl>
        <section className="sf-auth-next" aria-labelledby="auth-next-title">
          <h2 id="auth-next-title" className="ux4g-heading-xs-strong">
            {next === DEFAULT_NEXT_SERVICE
              ? 'Next: apply for a Residence Certificate'
              : 'Continue where you left off'}
          </h2>
          <p>{serviceSummary}</p>
          <div className="sf-auth-actions">
            <Link className="ux4g-btn-primary ux4g-btn-l" href={next}>
              {next === DEFAULT_NEXT_SERVICE ? 'Start application' : 'Continue'}
              <Icon name="arrow-right" size={18} />
            </Link>
          </div>
        </section>
        <p className="sf-auth-switch">
          <Link className="sf-auth-inline-link" href="/services">
            Browse all services
          </Link>
        </p>
      </>
    );
  }

  if (step === 'otp' && challenge) {
    return (
      <>
        <Progress step="otp" />
        <OtpVerifyStep
          key={challenge.challenge_id}
          idPrefix="register"
          challenge={challenge}
          title="Verify your mobile number"
          submitLabel="Verify and create account"
          busyLabel="Creating your account…"
          successLabel="Mobile number verified."
          backLabel="Edit your details"
          notice={
            resent ? (
              <FormAlert tone="success">
                A new OTP has been sent to {challenge.masked_mobile}.
              </FormAlert>
            ) : null
          }
          onBack={() => setStep('details')}
          onVerify={verify}
          onResend={resend}
        />
      </>
    );
  }

  return (
    <>
      <Progress step="details" />
      <header className="sf-auth-head">
        <p className="sf-auth-eyebrow ux4g-label-s-strong">
          <Icon name="user" size={16} />
          Create account
        </p>
        <h1 className="ux4g-heading-xl-strong">Create your citizen account</h1>
        <p className="ux4g-body-m-default">
          It takes about a minute. You will sign in with your mobile number and a one-time password
          — no password to create.
        </p>
      </header>
      {attempted && summaryItems.length > 0 ? (
        <ErrorSummary ref={summaryRef} items={summaryItems} />
      ) : null}
      {notice ? <FormAlert tone="error">{notice.message}</FormAlert> : null}
      <form className="sf-auth-form" noValidate onSubmit={(e) => void submitDetails(e)}>
        <TextInput
          id={FIELD_IDS.display_name}
          name="display_name"
          label="Full name"
          size="l"
          autoComplete="name"
          value={values.display_name}
          onChange={(e) => set('display_name', e.target.value)}
          onBlur={touch('display_name')}
          hint="As it should appear on your applications. In this sample environment, start with “SAMPLE” or “Lab”."
          error={visible('display_name')}
        />
        <TextInput
          id={FIELD_IDS.mobile}
          name="mobile"
          label="Mobile number"
          size="l"
          prefix="+91"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile number"
          value={values.mobile}
          onChange={(e) => set('mobile', normaliseMobile(e.target.value).slice(0, 10))}
          onBlur={touch('mobile')}
          hint="You will use this number to sign in. We will send an OTP to verify it."
          error={visible('mobile')}
        />
        <TextInput
          id={FIELD_IDS.email}
          name="email"
          label="Email address"
          optional
          size="l"
          type="email"
          autoComplete="email"
          spellCheck={false}
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          onBlur={touch('email')}
          hint="For application receipts and status updates."
          error={visible('email')}
        />
        <div className="sf-auth-language">
          <RadioGroup
            name="preferred_language"
            legend="Language for SMS and email updates"
            options={LAB_LANGUAGES.map((l) => ({
              value: l.value,
              label: <span lang={l.value}>{l.label}</span>,
            }))}
            value={values.preferred_language}
            onChange={(v) => {
              if (isLabLanguage(v)) set('preferred_language', v);
            }}
          />
        </div>
        <div className="sf-auth-consent">
          <Checkbox
            id={FIELD_IDS.consent}
            name="consent"
            checked={values.consent}
            onChange={(e) => {
              set('consent', e.target.checked);
              setTouched((t) => ({ ...t, consent: true }));
            }}
            error={Boolean(visible('consent'))}
            aria-describedby={visible('consent') ? 'reg-consent-error' : undefined}
            label="I agree to the terms of use and consent to my mobile number and email being used to verify my identity and send updates about my applications."
          />
          {visible('consent') ? (
            <p id="reg-consent-error" className="sf-auth-consent-error">
              {visible('consent')}
            </p>
          ) : null}
        </div>
        <div className="sf-auth-actions">
          <Button type="submit" size="l" disabled={busy}>
            {busy ? 'Sending OTP…' : 'Send OTP and continue'}
            {busy ? null : <Icon name="arrow-right" size={18} />}
          </Button>
        </div>
      </form>
      <p className="sf-auth-switch">
        Already have an account?{' '}
        <Link className="sf-auth-inline-link" href={signInHref}>
          Sign in
        </Link>
      </p>
    </>
  );
}
