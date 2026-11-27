import { FEE_TEMPLATES } from '@serviceform/studio-designers/fee';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'Fee designer - ServiceForm AI - Service Design Studio',
};

export default function FeesPage() {
  return (
    <DesignerHub
      title="Fee designer"
      description="Author fee schedules as versioned fee metadata (amount lines). SAMPLE_LAB_DUMMY overlays are labeled so they are never mistaken for statute. Freeze and pin through maker-checker — the designer never publishes alone."
      blankTitle="Start a blank fee schedule"
      blankSubtitle="One zero-amount line"
      blankHref="/fees/designer"
      blankCta="New blank fee schedule"
      blankBody="Use SAMPLE_LAB_DUMMY labels for lab overlays; Residence remains ₹0 unless policy says otherwise."
      draftAction="/fees/designer"
      draftKind="FEE"
      draftSubtitle="Saved fee drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Synthetic SAMPLE_LAB fee overlays"
      templates={FEE_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/fees/designer?template=${t.id}`,
      }))}
    />
  );
}
