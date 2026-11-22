import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/forms', label: 'Forms' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/rules', label: 'Rules' },
  { href: '/fees', label: 'Fees' },
  { href: '/sla', label: 'SLA' },
  { href: '/evidence', label: 'Evidence' },
  { href: '/credentials', label: 'Credentials' },
  { href: '/templates', label: 'Templates' },
  { href: '/session', label: 'Session' },
  { href: '/metadata', label: 'Metadata' },
  { href: '/publication', label: 'Publication' },
  { href: '/interop', label: 'Interop' },
  { href: '/services/new', label: 'New service' },
] as const;

export function StudioNav() {
  return (
    <nav aria-label="Studio">
      <ul className="ux4g-navbar-links">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
