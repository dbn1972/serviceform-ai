import { AppShell, Alert, Card, TextLink } from '@serviceform/ui-ux4g';
import { OfficerNav } from '../../components/OfficerNav';
import { RequireOfficerSession } from '../../components/RequireOfficerSession';

/**
 * SAMPLE_LAB helpdesk desk home (SF-50 role-aware login routing).
 * Full grievance ticket UI is owned by SF-52 (CMP-027); this page is the role desk landing.
 */
export default function HelpdeskPage() {
  return (
    <AppShell
      surface="officer_workbench"
      title="Helpdesk"
      environmentLabel="SAMPLE_LAB"
      nav={<OfficerNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Helpdesk desk</h1>
        <p className="ux4g-body-m-default">
          Role-code desk for SAMPLE_LAB_HELPDESK_L* officers. Routing uses CMP-004 session roles —
          never named officers.
        </p>
      </section>

      <Alert variant="info" title="Platform path (SAMPLE_LAB)">
        Login lands here when the SIM IdP assertion carries only helpdesk role codes. Case decide
        actions stay OPA fail-closed. CERTIFIED=false · G6=false.
      </Alert>

      <RequireOfficerSession>
        <Card
          title="Grievance tickets"
          subtitle="CMP-027 helpdesk · metadata role ladder"
          footer={
            <div className="sf-actions">
              <TextLink href="/applications">Case applications queue</TextLink>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Ticket triage and escalation UI ships with the grievance helpdesk slice. This desk home
            proves role-aware post-login routing for the helpdesk ladder.
          </p>
        </Card>
      </RequireOfficerSession>
    </AppShell>
  );
}
