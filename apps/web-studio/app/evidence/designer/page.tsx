import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { EvidenceDesigner } from '../../../components/evidence/EvidenceDesigner';
import { StudioNav } from '../../../components/StudioNav';
import { metaKindSource } from '../../../lib/designer-source';

export const metadata: Metadata = {
  title: 'Design evidence requirements - Evidence designer - Service Design Studio',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EvidenceDesignerPage({ searchParams }: Props) {
  const source = metaKindSource(await searchParams);
  const key = source.kind === 'blank' ? 'blank' : `${source.kind}:${source.id}`;
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
      layout="wide"
    >
      <EvidenceDesigner key={key} source={source} />
    </AppShell>
  );
}
