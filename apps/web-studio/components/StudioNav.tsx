import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/session', label: 'Session' },
  { href: '/metadata', label: 'Metadata' },
  { href: '/publication', label: 'Publication' },
] as const;

export function StudioNav() {
  return (
    <nav aria-label="Studio" className="ux4g-navbar">
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link className="ux4g-text-link-md" href={link.href}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
