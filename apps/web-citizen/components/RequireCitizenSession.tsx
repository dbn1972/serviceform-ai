'use client';

import { Alert, Button } from '@serviceform/ui-ux4g';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

type SessionState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'ok'; display_name: string; mobile: string };

/**
 * Soft gate for SAMPLE_LAB citizen routes. Redirects to /login when no session cookie.
 */
export function RequireCitizenSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/lab/session')
      .then((r) => r.json())
      .then((body: { authenticated?: boolean; display_name?: string; mobile?: string }) => {
        if (cancelled) return;
        if (body.authenticated && body.display_name && body.mobile) {
          setState({
            status: 'ok',
            display_name: body.display_name,
            mobile: body.mobile,
          });
          return;
        }
        setState({ status: 'anon' });
        const next = encodeURIComponent(pathname || '/services');
        router.replace(`/login?next=${next}`);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anon' });
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (state.status === 'loading') {
    return <p className="ux4g-body-m-default">Checking SAMPLE_LAB session…</p>;
  }
  if (state.status === 'anon') {
    return (
      <Alert variant="info" title="Sign-in required">
        Redirecting to SAMPLE_LAB citizen login…
        <div className="sf-actions">
          <Button onClick={() => router.push('/login')}>Open login</Button>
        </div>
      </Alert>
    );
  }

  return (
    <>
      <p className="ux4g-body-s-default sf-session-chip" data-testid="citizen-session-chip">
        Signed in as <strong>{state.display_name}</strong> · {state.mobile} · SAMPLE_LAB
      </p>
      {children}
    </>
  );
}
