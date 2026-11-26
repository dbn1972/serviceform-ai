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
          Sign in to open the desk that matches your role — applications, helpdesk, inspection,
          scheduling, search, or ops.
        </p>
        <div className="sf-meta-row">
          <span className="ux4g-tag-tonal-primary">Sample lab</span>
          <span className="ux4g-tag-outline-warning">G6 not issued</span>
        </div>
      </section>

      <Card
        title="Application queue"
        subtitle="Scrutiny and approving desks"
        footer={
          <div className="sf-actions">
            <TextLink href="/applications">Open applications</TextLink>
            <TextLink href="/helpdesk">Helpdesk</TextLink>
            <TextLink href="/inspection">Inspection</TextLink>
            <TextLink href="/scheduling">Scheduling</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Review submitted cases, raise deficiencies, and decide from your assigned desk. Final
          approval issues credentials through simulated connectors.
        </p>
      </Card>

      <Card
        title="Helpdesk"
        subtitle="Grievance tickets · desks L1–L3"
        footer={
          <div className="sf-actions">
            <TextLink href="/helpdesk">Open helpdesk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Citizen-raised grievances linked to applications. Assign by desk role, respond, resolve,
          or escalate. Not a statutory appeal court.
        </p>
      </Card>

      <Card
        title="Assisted apply"
        subtitle="CSC / counter channel"
        footer={
          <div className="sf-actions">
            <TextLink href="/assisted">Open assisted shell</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Operator files on behalf of a distinct citizen account with representation basis and
          fail-closed consent. Never impersonate.
        </p>
      </Card>

      <Card
        title="Inspection desk"
        subtitle="Schedule / result / deficiency noted"
        footer={
          <div className="sf-actions">
            <TextLink href="/inspection">Open inspection desk</TextLink>
            <TextLink href="/scheduling">Open scheduling</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Record non-statutory verification results for services that pin an inspection node —
          never a statutory approve or reject.
        </p>
      </Card>

      <Card
        title="Scheduling desk"
        subtitle="Appointment calendars"
        footer={
          <div className="sf-actions">
            <TextLink href="/scheduling">Open scheduling desk</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Book, reschedule, complete, or mark no-show on reusable capacity slots beside inspection.
        </p>
      </Card>

      <Card
        title="Search & ops"
        subtitle="Find cases · workload views"
        footer={
          <div className="sf-actions">
            <TextLink href="/search">Open case search</TextLink>
            <TextLink href="/ops">Open ops dashboard</TextLink>
          </div>
        }
      >
        <p className="ux4g-body-m-default">
          Faceted case projections and non-authoritative ops aggregates beyond a single queue.
        </p>
      </Card>
    </AppShell>
  );
}
