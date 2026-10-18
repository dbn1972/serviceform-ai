import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/session', label: 'Session' },
  { href: '/metadata', label: 'Metadata' },
  { href: '/publication', label: 'Publication' },
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
