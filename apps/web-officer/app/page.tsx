import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../components/OfficerNav';

export default function HomePage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Officer Workbench"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Officer Workbench</h1>
        <p className="ux4g-body-m-default">
          Role-aware SIM login routes each desk role_code to its queue — scrutiny, approving,
          helpdesk, inspection, or scheduling — then HUMAN_TASK decisions and SAMPLE_LAB credential
          issuance.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">
            Scrutiny · Approving · Helpdesk · Inspection · Scheduling · Search · Ops
          </span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
          <span className="ux4g-tag-outline-neutral">CERTIFIED=false</span>
        </div>
      </section>

      <Card
        title="Application queue"
        subtitle="CMP-017 desks from Studio workflow role_code · catalogue-generic"
        footer={
          <div className="sf-actions">
            <TextLink href="/applications">Open applications</TextLink>
            <TextLink href="/helpdesk">Helpdesk desk</TextLink>
            <TextLink href="/inspection">Inspection desk</TextLink>
            <TextLink href="/scheduling">Scheduling desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Sign in as a scrutiny, approving, helpdesk, or inspection desk officer (role codes only —
          never named people). Post-login routing seeds the matching desk; forwarding hands the case
          to the next HUMAN_TASK; final approval issues the credential through SIMULATED connectors.
        </p>
      </Card>

      <Card
        title="Helpdesk"
        subtitle="CMP-027 grievance tickets · role desks L1–L3"
        footer={
          <div className="sf-actions">
            <TextLink href="/helpdesk">Open helpdesk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Citizen-raised grievances linked to applications. Assign by role metadata, respond,
          resolve, or escalate. Not a statutory appeal court; CERTIFIED=false.
        </p>
      </Card>

      <Card
        title="Assisted apply"
        subtitle="CMP-057 · CSC channel · Constitution #36"
        footer={
          <div className="sf-actions">
            <TextLink href="/assisted">Open assisted shell</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Operator <code>applied_by</code> + citizen <code>applied_for</code> + representation basis
          + fail-closed consent. Never impersonate. CERTIFIED=false · G6=false.
        </p>
      </Card>

      <Card
        title="Inspection desk"
        subtitle="CMP-018 · schedule / result / deficiency-noted"
        footer={
          <div className="sf-actions">
            <TextLink href="/inspection">Open inspection desk</TextLink>
            <TextLink href="/scheduling">Open scheduling</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Metadata pins for services that require a verification node. Record VERIFIED /
          NOT_VERIFIED / INCONCLUSIVE / DEFICIENCY_NOTED — never statutory approve/reject.
          CERTIFIED=false · G6=false.
        </p>
      </Card>

      <Card
        title="Scheduling desk"
        subtitle="CMP-056 · Constitution #37 · appointment calendars"
        footer={
          <div className="sf-actions">
            <TextLink href="/scheduling">Open scheduling desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Reusable opaque appointment types and capacity slots beside inspection — book, reschedule,
          complete, or no-show. Atomic capacity; notify failure does not cancel. CERTIFIED=false ·
          G6=false.
        </p>
      </Card>

      <Card
        title="Search & ops"
        subtitle="M08 · CMP-035 / CMP-046 · find-case + workload views"
        footer={
          <div className="sf-actions">
            <TextLink href="/search">Open case search</TextLink>
            <TextLink href="/ops">Open ops dashboard</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Faceted case projections and non-authoritative ops aggregates beyond a single queue.
          Fail-closed OPA/RLS. No PII in facets. CERTIFIED=false · G6=false.
        </p>
      </Card>
    </AppShell>
  );
}
