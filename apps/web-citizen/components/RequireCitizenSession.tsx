'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useCitizenSession, type CitizenProfile } from '../lib/use-citizen-session';

const CitizenContext = createContext<CitizenProfile | null>(null);

/** Verified citizen for pages rendered inside `RequireCitizenSession`. */
export function useCitizen(): CitizenProfile {
  const citizen = useContext(CitizenContext);
  if (!citizen) throw new Error('useCitizen must be used inside RequireCitizenSession');
  return citizen;
}

/** Gate for SAMPLE_LAB citizen routes: redirects to sign-in (keeping `next`) without a session. */
export function RequireCitizenSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useCitizenSession();
  const signInHref = `/login?next=${encodeURIComponent(pathname || '/services')}`;

  useEffect(() => {
    if (session.status === 'anon') router.replace(signInHref);
  }, [session.status, router, signInHref]);

  if (session.status === 'signed-in') {
    return <CitizenContext.Provider value={session.profile}>{children}</CitizenContext.Provider>;
  }
  return (
    <div className="sf-gate" role="status">
      <span className="sf-spinner" aria-hidden="true" />
      {session.status === 'loading' ? (
        <p className="ux4g-body-m-default">Checking your sign-in…</p>
      ) : (
        <p className="ux4g-body-m-default">
          Taking you to sign in…{' '}
          <Link className="sf-auth-inline-link" href={signInHref}>
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
