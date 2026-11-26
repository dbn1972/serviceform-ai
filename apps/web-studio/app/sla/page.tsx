import { SLA_TEMPLATES } from '@serviceform/studio-designers/sla';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'SLA designer - ServiceForm AI - Service Design Studio',
};

export default function SlaPage() {
  return (
    <DesignerHub
      title="SLA designer"
      description="Author SLA clocks as versioned SLA metadata (ISO-8601 durations). Runtime evaluation stays with the SLA component. SAMPLE_LAB overlays must not invent statutory deadlines."
      blankTitle="Start a blank SLA pack"
      blankSubtitle="One processing clock"
      blankHref="/sla/designer"
      blankCta="New blank SLA pack"
      blankBody="Pause reasons such as DEFICIENCY_OPEN align with the lab deficiency path."
      draftAction="/sla/designer"
      draftKind="SLA"
      draftSubtitle="Saved SLA drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Synthetic SAMPLE_LAB SLA overlays"
      templates={SLA_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/sla/designer?template=${t.id}`,
      }))}
    />
  );
}
