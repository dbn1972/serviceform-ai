import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/applications', label: 'Applications' },
] as const;

export function OfficerNav() {
  return (
    <nav aria-label="Officer" className="ux4g-navbar">
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
