import Link from 'next/link';
import type { ReactNode } from 'react';

export type Crumb = { href?: string; label: string };

export type CitizenPageHeaderProps = {
  title: string;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  crumbs?: readonly Crumb[];
  meta?: ReactNode;
  actions?: ReactNode;
};

/** Citizen page header continuing the identity & access design (UX4G blue band). */
export function CitizenPageHeader({
  title,
  eyebrow,
  lead,
  crumbs,
  meta,
  actions,
}: CitizenPageHeaderProps) {
  return (
    <section className="sf-page-hero sf-citizen-hero">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb">
          <ol className="sf-breadcrumb">
            {crumbs.map((crumb) => (
              <li key={crumb.label}>
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {eyebrow ? <p className="sf-citizen-hero-eyebrow ux4g-label-s-strong">{eyebrow}</p> : null}
      <h1 className="ux4g-heading-2xl-strong">{title}</h1>
      {lead ? <p className="ux4g-body-l-default">{lead}</p> : null}
      {meta ? <div className="sf-meta-row">{meta}</div> : null}
      {actions ? <div className="sf-citizen-hero-actions">{actions}</div> : null}
    </section>
  );
}
