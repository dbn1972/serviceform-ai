'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isHelpdeskRole, isInspectionRole } from '../lib/portal/desk';

const baseLinks = [
  { href: '/', label: 'Home' },
  { href: '/applications', label: 'Applications' },
  { href: '/assisted', label: 'Assisted apply' },
] as const;

export function OfficerNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [showHelpdesk, setShowHelpdesk] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [showScheduling, setShowScheduling] = useState(false);
  const [showSearchOps, setShowSearchOps] = useState(false);

  useEffect(() => {
    void fetch('/api/portal/session')
      .then((r) => r.json() as Promise<{ authenticated?: boolean; roles?: string[] }>)
      .then((body) => {
        setSignedIn(Boolean(body.authenticated));
        const roles = Array.isArray(body.roles) ? body.roles : [];
        // SF-50 helpdesk personas + SF-52 case-officer grievance desk.
        setShowHelpdesk(roles.some(isHelpdeskRole) || roles.includes('SAMPLE_LAB_CASE_OFFICER'));
        // SF-57 inspection desk + case officer can open CMP-018.
        const inspectionDesk =
          roles.some(isInspectionRole) || roles.includes('SAMPLE_LAB_CASE_OFFICER');
        setShowInspection(inspectionDesk);
        // SF-62 scheduling shell beside inspection (same desk roles).
        setShowScheduling(inspectionDesk);
        // SF-63 M08 search / ops golden path.
        setShowSearchOps(
          roles.includes('SAMPLE_LAB_CASE_OFFICER') ||
            roles.includes('SAMPLE_LAB_SCRUTINY_OFFICER') ||
            roles.includes('SAMPLE_LAB_APPROVING_AUTHORITY') ||
            roles.includes('SAMPLE_LAB_OPS_ANALYST'),
        );
      })
      .catch(() => {
        setSignedIn(false);
        setShowHelpdesk(false);
        setShowInspection(false);
        setShowScheduling(false);
        setShowSearchOps(false);
      });
  }, [pathname]);

  async function signOut() {
    await fetch('/api/portal/session', { method: 'DELETE' });
    setSignedIn(false);
    setShowHelpdesk(false);
    setShowInspection(false);
    setShowScheduling(false);
    setShowSearchOps(false);
    router.replace('/login');
    router.refresh();
  }

  const links = [
    ...baseLinks,
    ...(showHelpdesk ? ([{ href: '/helpdesk', label: 'Helpdesk' }] as const) : []),
    ...(showInspection ? ([{ href: '/inspection', label: 'Inspection' }] as const) : []),
    ...(showScheduling ? ([{ href: '/scheduling', label: 'Scheduling' }] as const) : []),
    ...(showSearchOps
      ? ([
          { href: '/search', label: 'Search' },
          { href: '/ops', label: 'Ops' },
        ] as const)
      : []),
  ];

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
