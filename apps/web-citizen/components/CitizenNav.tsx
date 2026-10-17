import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/services/IND-SOC-002', label: 'Residence Certificate' },
  { href: '/certificates', label: 'My certificates' },
] as const;

export function CitizenNav() {
  return (
    <nav aria-label="Citizen" className="ux4g-navbar">
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
