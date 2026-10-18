import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/applications', label: 'Applications' },
] as const;

export function OfficerNav() {
  return (
    <nav aria-label="Officer">
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
