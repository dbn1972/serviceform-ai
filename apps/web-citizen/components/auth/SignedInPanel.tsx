'use client';

import { Button, Icon } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import { useState } from 'react';

export function SignedInPanel({
  name,
  next,
  onSignOut,
}: {
  name: string;
  next: string;
  onSignOut: () => Promise<void>;
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
            void onSignOut();
          }}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </>
  );
}
