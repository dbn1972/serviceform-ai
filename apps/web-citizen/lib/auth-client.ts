import type { LabOtpPurpose } from '@serviceform/m10-sample-lab/identity-rules';

export type OtpChallenge = {
  challenge_id: string;
  purpose: LabOtpPurpose;
  masked_mobile: string;
  expires_at: string;
  resend_after: string;
  max_attempts: number;
  simulated_sms?: { to: string; code: string; body: string };
};

export type SessionSummary = {
  authenticated: true;
  display_name: string;
  masked_mobile: string;
  email: string | null;
  preferred_language: 'en' | 'hi';
};

export type ApiError = {
  status: number;
  error_code: string;
  message: string;
  reason?: string;
  attempts_remaining?: number;
  field?: string;
  field_errors?: Record<string, string>;
  /** Client-side follow-up offered with the error, e.g. "Sign in instead". */
  action?: { href: string; label: string };
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: json as T };
    return {
      ok: false,
      error: {
        status: res.status,
        error_code: typeof json['error_code'] === 'string' ? json['error_code'] : 'SF-SYS-001',
        message: typeof json['message'] === 'string' ? json['message'] : 'Something went wrong',
        ...(json as Partial<ApiError>),
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        error_code: 'SF-SYS-004',
        message: 'We could not reach the portal. Check your connection and try again.',
      },
    };
  }
}

export function requestOtp(mobile: string, purpose: LabOtpPurpose) {
  return postJson<OtpChallenge>('/api/lab/otp/challenges', { mobile, purpose });
}

/** Only same-origin absolute paths are honoured as post-sign-in destinations. */
export function safeNext(raw: string | null | undefined, fallback = '/services'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Avatar initials, ignoring the synthetic `SAMPLE`/`Lab` prefix used in SAMPLE_LAB names. */
export function initials(name: string): string {
  const words = name
    .replace(/^(SAMPLE|Lab)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return letters || name.charAt(0).toUpperCase();
}
