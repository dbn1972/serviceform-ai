'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [
  { href: '/', label: 'Home' },
  { href: '/applications', label: 'Applications' },
] as const;

export function OfficerNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void fetch('/api/portal/session')
      .then((r) => r.json() as Promise<{ authenticated?: boolean }>)
      .then((body) => setSignedIn(Boolean(body.authenticated)))
      .catch(() => setSignedIn(false));
  }, [pathname]);

  async function signOut() {
    await fetch('/api/portal/session', { method: 'DELETE' });
    setSignedIn(false);
    router.replace('/login');
    router.refresh();
  }

  return (
    <nav aria-label="Officer">
      <ul className="ux4g-navbar-links">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
        <li>
          {signedIn ? (
            <button type="button" className="ux4g-btn-text-neutral" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </li>
      </ul>
    </nav>
  );
}
