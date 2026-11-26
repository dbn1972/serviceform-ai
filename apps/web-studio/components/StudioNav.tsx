'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

/** Always-visible destinations — keep to one header row. */
const primaryLinks = [
  { href: '/', label: 'Home' },
  { href: '/forms', label: 'Forms' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/rules', label: 'Rules' },
  { href: '/templates', label: 'Templates' },
  { href: '/publication', label: 'Publication' },
  { href: '/services/new', label: 'New service' },
  { href: '/session', label: 'Session' },
] as const;

/** Overflow groups: Designers · Catalogue · Publish (audit Wave 1). */
const moreGroups = [
  {
    label: 'Designers',
    links: [
      { href: '/fees', label: 'Fees' },
      { href: '/sla', label: 'SLA' },
      { href: '/evidence', label: 'Evidence' },
      { href: '/credentials', label: 'Credentials' },
      { href: '/forms/metrics', label: 'Forms KPIs' },
    ],
  },
  {
    label: 'Catalogue & publish',
    links: [
      { href: '/metadata', label: 'Metadata' },
      { href: '/interop', label: 'Interop' },
    ],
  },
] as const;

export function StudioNav() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLLIElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav aria-label="Studio">
      <ul className="ux4g-navbar-links">
        {primaryLinks.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
        <li ref={rootRef}>
          <div
            className={
              open
                ? 'ux4g-dropdown ux4g-dropdown-button ux4g-dropdown-m is-open'
                : 'ux4g-dropdown ux4g-dropdown-button ux4g-dropdown-m'
            }
          >
            <button
              type="button"
              className="ux4g-dropdown-control"
              aria-expanded={open}
              aria-haspopup="menu"
              aria-controls={menuId}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="ux4g-dropdown-button-content">More</span>
              <span className="ux4g-dropdown-caret" aria-hidden="true" />
            </button>
            <div
              id={menuId}
              className="ux4g-dropdown-menu"
              role="menu"
              aria-label="More Studio destinations"
            >
              <ul className="ux4g-list">
                {moreGroups.map((group) => (
                  <li key={group.label} className="ux4g-list-item" role="none">
                    <p className="ux4g-label-s-default">{group.label}</p>
                    <ul className="ux4g-list">
                      {group.links.map((link) => (
                        <li key={link.href} className="ux4g-list-item" role="none">
                          <Link
                            role="menuitem"
                            className="ux4g-dropdown-option"
                            href={link.href}
                            onClick={() => setOpen(false)}
                          >
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </li>
      </ul>
    </nav>
  );
}
