import { EVIDENCE_TEMPLATES } from '@serviceform/studio-designers/evidence';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'Evidence designer - ServiceForm AI - Service Design Studio',
};

export default function EvidencePage() {
  return (
    <DesignerHub
      title="Evidence designer"
      description="Author evidence requirements as versioned evidence metadata. Technical upload accept is not business verification. SAMPLE_LAB_DUMMY labels are allowed for lab overlays."
      blankTitle="Start a blank evidence pack"
      blankSubtitle="One proof-of-address requirement"
      blankHref="/evidence/designer"
      blankCta="New blank evidence pack"
      blankBody="Officers still verify meaning; deficiency and resubmit stay on the case path."
      draftAction="/evidence/designer"
      draftKind="EVIDENCE"
      draftSubtitle="Saved evidence drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Synthetic SAMPLE_LAB evidence overlays"
      templates={EVIDENCE_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/evidence/designer?template=${t.id}`,
      }))}
    />
  );
}
