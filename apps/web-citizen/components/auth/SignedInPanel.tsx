'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type ExistingSession = { status: 'checking' | 'anon' } | { status: 'signed-in'; name: string };

export function useExistingSession() {
  const [session, setSession] = useState<ExistingSession>({ status: 'checking' });
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/lab/session')
      .then((r) => r.json())
      .then((body: { authenticated?: boolean; display_name?: string }) => {
        if (cancelled) return;
        setSession(
          body.authenticated && body.display_name
            ? { status: 'signed-in', name: body.display_name }
            : { status: 'anon' },
        );
      })
      .catch(() => {
        if (!cancelled) setSession({ status: 'anon' });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { session, clear: () => setSession({ status: 'anon' }) };
}

export function SignedInPanel({
  name,
  next,
  onSignedOut,
}: {
  name: string;
  next: string;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <span className="sf-auth-success-mark">
        <Icon name="user" size={26} />
      </span>
      <header className="sf-auth-head">
        <h1 className="ux4g-heading-xl-strong">You are already signed in</h1>
        <p className="ux4g-body-m-default">
          Signed in as <strong>{name}</strong>. Continue where you left off, or sign out to use a
          different mobile number.
        </p>
      </header>
      <div className="sf-auth-actions">
        <Link className="ux4g-btn-primary ux4g-btn-l" href={next}>
          Continue
          <Icon name="arrow-right" size={18} />
        </Link>
        <Button
          variant="outline-neutral"
          size="l"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void fetch('/api/lab/session', { method: 'DELETE' }).finally(() => {
              setBusy(false);
              onSignedOut();
            });
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </>
  );
}
