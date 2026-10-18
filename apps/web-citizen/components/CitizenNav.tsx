import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/services/IND-SOC-002', label: 'Residence Certificate' },
  { href: '/certificates', label: 'My certificates' },
] as const;

export function CitizenNav() {
  return (
    <nav aria-label="Citizen">
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
