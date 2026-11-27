import { WORKFLOW_TEMPLATES } from '@serviceform/studio-designers/workflow';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'Workflow designer - ServiceForm AI - Service Design Studio',
};

export default function WorkflowsPage() {
  return (
    <DesignerHub
      title="Workflow designer"
      description="Draw how a case moves: officer tasks, waits for committed case steps, rule checks and platform ports. The canvas edits the canonical ServiceForm Workflow Model; Temporal runs it. BPMN 2.0 is import and export only."
      blankTitle="Start a blank workflow"
      blankSubtitle="Start and End, ready to extend"
      blankHref="/workflows/designer"
      blankCta="New blank workflow"
      blankBody="Officer tasks are assigned to a role, organisation and jurisdiction, never to a named officer."
      draftAction="/workflows/designer"
      draftKind="WORKFLOW"
      draftSubtitle="Saved workflow drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Graphs the platform already accepts"
      templates={WORKFLOW_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/workflows/designer?template=${t.id}`,
      }))}
    />
  );
}
