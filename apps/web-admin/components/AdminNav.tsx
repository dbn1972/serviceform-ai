import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/session', label: 'Session' },
  { href: '/bindings', label: 'Bindings' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/branding', label: 'Branding' },
] as const;

export function AdminNav() {
  return (
    <nav aria-label="Administration" className="ux4g-navbar">
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
