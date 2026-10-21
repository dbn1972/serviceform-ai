'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { initials } from '../lib/auth-client';
import { useCitizenSession } from '../lib/use-citizen-session';

type NavLink = { href: string; label: string };

const publicLinks: readonly NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/login', label: 'Sign in' },
  { href: '/register', label: 'Create account' },
];

const signedInLinks: readonly NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/certificates', label: 'My applications' },
];

function currentFor(pathname: string, href: string): 'page' | 'location' | undefined {
  if (pathname === href) return 'page';
  return href !== '/' && pathname.startsWith(`${href}/`) ? 'location' : undefined;
}

export function CitizenNav() {
  const pathname = usePathname() ?? '/';
  const session = useCitizenSession();
  const [signingOut, setSigningOut] = useState(false);
  const links =
    session.status === 'signed-in'
      ? signedInLinks
      : session.status === 'anon'
        ? publicLinks
        : publicLinks.slice(0, 1);

  return (
    <div className="sf-citizen-nav">
      <nav aria-label="Citizen">
        <ul className="ux4g-navbar-links">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} aria-current={currentFor(pathname, link.href)}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {session.status === 'signed-in' ? (
        <div className="sf-account" data-testid="citizen-account">
          <span className="sf-account-avatar" aria-hidden="true">
            {initials(session.profile.display_name)}
          </span>
          <span className="sf-account-text">
            <span className="sf-account-name">{session.profile.display_name}</span>
            <span className="sf-account-meta">{session.profile.masked_mobile} · verified</span>
          </span>
          <button
            type="button"
            className="ux4g-btn-outline-neutral ux4g-btn-s"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void session.signOut();
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
