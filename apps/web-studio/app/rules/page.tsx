import { RULE_TEMPLATES } from '@serviceform/studio-designers/rules';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'Rules designer - ServiceForm AI - Service Design Studio',
};

export default function RulesPage() {
  return (
    <DesignerHub
      title="Rules designer"
      description="Write indicative checks as a decision table: when the inputs match a row, the row sets an advisory outcome and reason codes. Test every case on the rules engine before you freeze the pack. Rules never approve or reject an application; officers decide."
      blankTitle="Start a blank rule pack"
      blankSubtitle="One input, an outcome and a reasons column"
      blankHref="/rules/designer"
      blankCta="New blank rule pack"
      blankBody="Use advisory outcome codes such as MEETS_CRITERIA or REFER_TO_OFFICER, never a final decision."
      draftAction="/rules/designer"
      draftKind="RULES"
      draftSubtitle="Saved rule pack drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Synthetic SAMPLE_LAB policies"
      templates={RULE_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/rules/designer?template=${t.id}`,
      }))}
    />
  );
}
