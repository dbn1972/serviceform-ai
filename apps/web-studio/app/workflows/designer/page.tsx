import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { StudioNav } from '../../../components/StudioNav';
import { WorkflowDesigner } from '../../../components/workflows/WorkflowDesigner';
import { workflowSource } from '../../../lib/designer-source';

export const metadata: Metadata = {
  title: 'Design a workflow - Workflow designer - Service Design Studio',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function WorkflowDesignerPage({ searchParams }: Props) {
  const source = workflowSource(await searchParams);
  const key = source.kind === 'blank' ? 'blank' : `${source.kind}:${source.id}`;
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
      layout="wide"
    >
      <WorkflowDesigner key={key} source={source} />
    </AppShell>
  );
}
