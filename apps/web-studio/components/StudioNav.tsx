import Link from 'next/link';

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

/** Overflow groups: Designers · Catalogue · Publish · Session (audit Wave 1). */
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
  return (
    <nav aria-label="Studio">
      <ul className="ux4g-navbar-links">
        {primaryLinks.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
        <li>
          <details className="sf-studio-nav-more">
            <summary>More</summary>
            <div
              className="sf-studio-nav-more-menu"
              role="group"
              aria-label="More Studio destinations"
            >
              {moreGroups.map((group) => (
                <div key={group.label}>
                  <p className="sf-studio-nav-group">{group.label}</p>
                  {group.links.map((link) => (
                    <Link key={link.href} href={link.href}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </li>
      </ul>
    </nav>
  );
}
