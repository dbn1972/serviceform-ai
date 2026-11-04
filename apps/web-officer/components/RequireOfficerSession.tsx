'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

type State = 'loading' | 'signed-in' | 'anon';

/** Redirects to sign-in unless the CMP-004 officer session (read through the BFF) is active. */
export function RequireOfficerSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/portal/session')
      .then((r) => r.json() as Promise<{ authenticated?: boolean }>)
      .then((body) => {
        if (!cancelled) setState(body.authenticated ? 'signed-in' : 'anon');
      })
      .catch(() => {
        if (!cancelled) setState('anon');
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (state === 'anon') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [state, router, pathname]);

  if (state === 'signed-in') return <>{children}</>;
  return (
    <p className="ux4g-body-m-default" role="status">
      {state === 'loading' ? 'Checking your session…' : 'Redirecting to sign in…'}
    </p>
  );
}
