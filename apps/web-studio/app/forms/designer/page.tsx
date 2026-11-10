import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { FormDesigner } from '../../../components/forms/FormDesigner';
import { StudioNav } from '../../../components/StudioNav';
import { designerSource } from '../../../lib/designer-source';

export const metadata: Metadata = {
  title: 'Design a form - Forms designer - Service Design Studio',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DesignerPage({ searchParams }: Props) {
  const source = designerSource(await searchParams);
  const key =
    source.kind === 'document' ? source.id : source.kind === 'template' ? source.source : 'blank';
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
      layout="wide"
    >
      <FormDesigner key={key} source={source} />
    </AppShell>
  );
}
