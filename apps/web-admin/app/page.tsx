import { Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { AdminShell } from '../components/AdminShell';

const desks = [
  {
    href: '/bindings',
    title: 'Bindings',
    subtitle: 'Pin TenantServiceBinding versions',
    body: 'Create drafts, run maker-checker publish, and prove the lab eng seal. Applications pin the published version — silent repoint is forbidden.',
    cta: 'Open bindings',
  },
  {
    href: '/reviews',
    title: 'Checker reviews',
    subtitle: 'Maker ≠ checker queue',
    body: 'Approve or reject publication requests. The same principal cannot approve their own request.',
    cta: 'Open reviews',
  },
  {
    href: '/users',
    title: 'Users',
    subtitle: 'Tenant workforce directory',
    body: 'Manage tenant workforce accounts via Keycloak Admin REST when configured, otherwise a labelled SIMULATED adapter.',
    cta: 'Open users',
  },
  {
    href: '/branding',
    title: 'Branding',
    subtitle: 'UX4G token overlay only',
    body: 'Apply allowlisted tenant tokens. No arbitrary CSS or a second design system.',
    cta: 'Open branding',
  },
  {
    href: '/analytics',
    title: 'Analytics',
    subtitle: 'Published metric definitions',
    body: 'Browse aggregate MIS definitions. No person-level fields; OpenSearch path remains a SIMULATED lab mirror.',
    cta: 'Open analytics',
  },
  {
    href: '/discovery',
    title: 'Discovery',
    subtitle: 'Catalogue browse',
    body: 'Search published SAMPLE_LAB offers by keyword and jurisdiction. Results are availability hints, never eligibility decisions.',
    cta: 'Open discovery',
  },
  {
    href: '/forms-kpi',
    title: 'Forms KPIs',
    subtitle: 'Read-only product measures',
    body: 'Funnel, latency, authoring, and cross-tenant leakage checks for the forms product desk.',
    cta: 'Open forms KPIs',
  },
  {
    href: '/session',
    title: 'Session',
    subtitle: 'SIMULATED workforce sign-in',
    body: 'Establish a lab admin session role for binder, checker, and ops desks.',
    cta: 'Open session',
  },
] as const;

export default function HomePage() {
  return (
    <AdminShell title="Administration">
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Administration</h1>
        <p className="ux4g-body-m-default">
          Tenant administration for bindings, workforce, branding, analytics, and discovery on the
          SAMPLE_LAB golden path.
        </p>
      </section>

      <Alert variant="warning" title="Sample lab — not production certified">
        This portal is SAMPLE_LAB only. G6 is not issued. Do not treat desk actions as a production
        certification claim.
      </Alert>

      <div className="sf-stack">
        {desks.map((desk) => (
          <Card
            key={desk.href}
            title={desk.title}
            subtitle={desk.subtitle}
            footer={
              <div className="sf-actions">
                <TextLink href={desk.href}>{desk.cta}</TextLink>
              </div>
            }
          >
            <p className="ux4g-body-m-default">{desk.body}</p>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}
