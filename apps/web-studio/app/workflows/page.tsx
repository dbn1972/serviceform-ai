import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { WORKFLOW_TEMPLATES } from '@serviceform/studio-designers/workflow';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Workflow designer - ServiceForm AI - Service Design Studio',
};

export default function WorkflowsPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Workflow designer</h1>
        <p className="ux4g-body-m-default">
          Draw how a case moves: officer tasks, waits for committed case steps, rule checks and
          platform ports. The canvas edits the canonical ServiceForm Workflow Model; CMP-016 runs it
          on Temporal. BPMN 2.0 is import and export only.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-016 · CMP-033 · CMP-051 · CMP-052</span>
          <span className="ux4g-tag-tonal-info">Temporal runtime · BPMN interop only</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank workflow"
          subtitle="Start and End, ready to extend"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/workflows/designer">
                New blank workflow
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Officer tasks are assigned to a role, organisation and jurisdiction, never to a named
            officer.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 WORKFLOW documents">
          <OpenDraft action="/workflows/designer" kind="WORKFLOW" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Graphs CMP-016 already accepts">
        <ul className="sf-designer-recent">
          {WORKFLOW_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink href={`/workflows/designer?template=${t.id}`}>{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
