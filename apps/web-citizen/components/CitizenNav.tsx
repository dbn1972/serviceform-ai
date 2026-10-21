'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const publicLinks = [
  { href: '/', label: 'Home' },
  { href: '/login', label: 'Sign in' },
  { href: '/register', label: 'Create account' },
] as const;

const signedInLinks = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/services/IND-SOC-002', label: 'Residence Certificate' },
  { href: '/certificates', label: 'My certificates' },
] as const;

export function CitizenNav() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void fetch('/api/lab/session')
      .then((r) => r.json())
      .then((body: { authenticated?: boolean }) => setSignedIn(Boolean(body.authenticated)));
  }, [pathname]);

  const links = signedIn ? signedInLinks : publicLinks;

  return (
    <nav aria-label="Citizen">
      <ul className="ux4g-navbar-links">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
