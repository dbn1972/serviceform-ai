import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RecentDraft } from '../lib/recent-drafts';
import { OpenDraft } from './forms/OpenDraft';
import { StudioNav } from './StudioNav';

export type DesignerHubTemplate = {
  id: string;
  title: string;
  description: string;
  href: string;
};

export type DesignerHubProps = {
  title: string;
  description: string;
  blankTitle: string;
  blankSubtitle: string;
  blankHref: string;
  blankCta: string;
  blankBody: string;
  draftAction: string;
  draftKind: NonNullable<RecentDraft['kind']>;
  draftSubtitle: string;
  templatesTitle: string;
  templatesSubtitle: string;
  templates?: readonly DesignerHubTemplate[];
  /** When set, replaces the default searchable template list (e.g. Forms catalogue table). */
  templatesSlot?: ReactNode;
  heroSecondary?: { href: string; label: string };
};

/**
 * Shared Studio designer landing chrome: one Sample lab tag, primary blank CTA,
 * open-draft card, and template list/table — no CMP / CERTIFIED=false badge stack.
 */
export function DesignerHub({
  title,
  description,
  blankTitle,
  blankSubtitle,
  blankHref,
  blankCta,
  blankBody,
  draftAction,
  draftKind,
  draftSubtitle,
  templatesTitle,
  templatesSubtitle,
  templates = [],
  templatesSlot,
  heroSecondary,
}: DesignerHubProps) {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">{title}</h1>
        <p className="ux4g-body-m-default">{description}</p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-outline-warning">Sample lab</span>
          {heroSecondary ? (
            <TextLink href={heroSecondary.href}>{heroSecondary.label}</TextLink>
          ) : null}
        </div>
      </section>

      <div className="sf-designer-start">
        <Card
          title={blankTitle}
          subtitle={blankSubtitle}
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href={blankHref}>
                {blankCta}
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">{blankBody}</p>
        </Card>
        <Card title="Open a saved draft" subtitle={draftSubtitle}>
          <OpenDraft action={draftAction} kind={draftKind} />
        </Card>
      </div>

      <Card title={templatesTitle} subtitle={templatesSubtitle}>
        {templatesSlot ?? (
          <ul className="sf-designer-recent">
            {templates.map((t) => (
              <li key={t.id}>
                <Link className="ux4g-btn-outline-primary ux4g-btn-s" href={t.href}>
                  {`Open ${t.title}`}
                </Link>
                <span className="ux4g-body-s-default">{t.description}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
