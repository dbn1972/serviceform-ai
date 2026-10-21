'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export type CitizenProfile = {
  citizen_id: string;
  display_name: string;
  mobile: string;
  masked_mobile: string;
  email?: string;
  preferred_language: 'en' | 'hi';
};

export type CitizenSessionState =
  { status: 'loading' } | { status: 'anon' } | { status: 'signed-in'; profile: CitizenProfile };

type SessionBody = Partial<CitizenProfile> & { authenticated?: boolean };

const SESSION_EVENT = 'sf-citizen-session-changed';

/** Tell every session consumer (header, gates) to re-read the session without a navigation. */
export function announceSessionChange(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Reads the SAMPLE_LAB OTP session; refreshes on navigation so the header follows sign-in/out. */
export function useCitizenSession(): CitizenSessionState & { signOut: () => Promise<void> } {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<CitizenSessionState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    window.addEventListener(SESSION_EVENT, bump);
    return () => window.removeEventListener(SESSION_EVENT, bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/lab/session')
      .then((r) => r.json() as Promise<SessionBody>)
      .then((body) => {
        if (cancelled) return;
        if (body.authenticated && body.citizen_id && body.display_name && body.mobile) {
          setState({
            status: 'signed-in',
            profile: {
              citizen_id: body.citizen_id,
              display_name: body.display_name,
              mobile: body.mobile,
              masked_mobile: body.masked_mobile ?? body.mobile,
              ...(body.email ? { email: body.email } : {}),
              preferred_language: body.preferred_language === 'hi' ? 'hi' : 'en',
            },
          });
        } else {
          setState({ status: 'anon' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anon' });
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, revision]);

  const signOut = useCallback(async () => {
    await fetch('/api/lab/session', { method: 'DELETE' });
    setState({ status: 'anon' });
    announceSessionChange();
    router.replace('/login?signed_out=1');
    router.refresh();
  }, [router]);

  return { ...state, signOut };
}
