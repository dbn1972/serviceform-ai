import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/session', label: 'Session' },
  { href: '/users', label: 'Users' },
  { href: '/bindings', label: 'Bindings' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/branding', label: 'Branding' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/forms-kpi', label: 'Forms KPIs' },
  { href: '/discovery', label: 'Discovery' },
] as const;

/** Horizontal header nav for AppShell — never dump as a vertical body list. */
export function AdminNav() {
  return (
    <nav aria-label="Administration">
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
