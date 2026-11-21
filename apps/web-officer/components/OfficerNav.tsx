'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isHelpdeskRole } from '../lib/portal/desk';

const baseLinks = [
  { href: '/', label: 'Home' },
  { href: '/applications', label: 'Applications' },
] as const;

export function OfficerNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [showHelpdesk, setShowHelpdesk] = useState(false);

  useEffect(() => {
    void fetch('/api/portal/session')
      .then((r) => r.json() as Promise<{ authenticated?: boolean; roles?: string[] }>)
      .then((body) => {
        setSignedIn(Boolean(body.authenticated));
        const roles = Array.isArray(body.roles) ? body.roles : [];
        // SF-50 helpdesk personas + SF-52 case-officer grievance desk.
        setShowHelpdesk(roles.some(isHelpdeskRole) || roles.includes('SAMPLE_LAB_CASE_OFFICER'));
      })
      .catch(() => {
        setSignedIn(false);
        setShowHelpdesk(false);
      });
  }, [pathname]);

  async function signOut() {
    await fetch('/api/portal/session', { method: 'DELETE' });
    setSignedIn(false);
    setShowHelpdesk(false);
    router.replace('/login');
    router.refresh();
  }

  const links = showHelpdesk
    ? [...baseLinks, { href: '/helpdesk', label: 'Helpdesk' } as const]
    : baseLinks;

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
