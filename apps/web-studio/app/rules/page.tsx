import { AppShell, Card, TextLink } from '@serviceform/ui-ux4g';
import { RULE_TEMPLATES } from '@serviceform/studio-designers/rules';
import type { Metadata } from 'next';
import Link from 'next/link';
import { OpenDraft } from '../../components/forms/OpenDraft';
import { StudioNav } from '../../components/StudioNav';

export const metadata: Metadata = {
  title: 'Rules designer - ServiceForm AI - Service Design Studio',
};

export default function RulesPage() {
  return (
    <AppShell
      surface="service_studio"
      title="Service Design Studio"
      environmentLabel="SAMPLE_LAB"
      nav={<StudioNav />}
    >
      <section className="sf-page-hero">
        <h1 className="ux4g-heading-2xl-strong">Rules designer</h1>
        <p className="ux4g-body-m-default">
          Write indicative checks as a decision table: when the inputs match a row, the row sets an
          advisory outcome and reason codes. Test every case on the CMP-008 ZEN engine before you
          freeze the pack. Rules never approve or reject an application; officers decide.
        </p>
        <div className="sf-tag-row">
          <span className="ux4g-tag-tonal-primary">CMP-008 · CMP-033 · CMP-051 · CMP-052</span>
          <span className="ux4g-tag-tonal-info">GoRules JDM · ZEN engine · advisory only</span>
          <span className="ux4g-tag-outline-warning">SAMPLE_LAB · not CERTIFIED</span>
        </div>
      </section>
      <div className="sf-designer-start">
        <Card
          title="Start a blank rule pack"
          subtitle="One input, an outcome and a reasons column"
          footer={
            <div className="sf-actions">
              <Link className="ux4g-btn-primary ux4g-btn-m" href="/rules/designer">
                New blank rule pack
              </Link>
            </div>
          }
        >
          <p className="ux4g-body-m-default">
            Use advisory outcome codes such as MEETS_CRITERIA or REFER_TO_OFFICER, never a final
            decision.
          </p>
        </Card>
        <Card title="Open a saved draft" subtitle="CMP-033 RULES documents">
          <OpenDraft action="/rules/designer" kind="RULES" />
        </Card>
      </div>
      <Card title="Start from a template" subtitle="Synthetic SAMPLE_LAB policies">
        <ul className="sf-designer-recent">
          {RULE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <TextLink href={`/rules/designer?template=${t.id}`}>{`Open ${t.title}`}</TextLink>
              <span className="ux4g-body-s-default">{t.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
