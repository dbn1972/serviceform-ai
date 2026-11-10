import { AppShell } from '@serviceform/ui-ux4g';
import type { Metadata } from 'next';
import { StudioNav } from '../../../components/StudioNav';
import { RulesDesigner } from '../../../components/rules/RulesDesigner';
import { rulesSource } from '../../../lib/designer-source';

export const metadata: Metadata = {
  title: 'Design a rule pack - Rules designer - Service Design Studio',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RulesDesignerPage({ searchParams }: Props) {
  const source = rulesSource(await searchParams);
  const key = source.kind === 'blank' ? 'blank' : `${source.kind}:${source.id}`;
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
      layout="wide"
    >
      <RulesDesigner key={key} source={source} />
    </AppShell>
  );
}
