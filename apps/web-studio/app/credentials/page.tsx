import { CREDENTIAL_TEMPLATES } from '@serviceform/studio-designers/credential';
import type { Metadata } from 'next';
import { DesignerHub } from '../../components/DesignerHub';

export const metadata: Metadata = {
  title: 'Credential designer - ServiceForm AI - Service Design Studio',
};

export default function CredentialsPage() {
  return (
    <DesignerHub
      title="Credential designer"
      description="Author credential templates as versioned credential metadata (template key and DigiLocker labels). SAMPLE_LAB uses SIM publish; REAL DigiLocker remains owner-held."
      blankTitle="Start a blank credential template"
      blankSubtitle="One template key and DigiLocker label"
      blankHref="/credentials/designer"
      blankCta="New blank credential template"
      blankBody="Keep DigiLocker labels clearly SAMPLE_LAB_DUMMY when using lab overlays."
      draftAction="/credentials/designer"
      draftKind="CREDENTIAL"
      draftSubtitle="Saved credential drafts in this browser"
      templatesTitle="Start from a template"
      templatesSubtitle="Synthetic SAMPLE_LAB credential overlays"
      templates={CREDENTIAL_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        href: `/credentials/designer?template=${t.id}`,
      }))}
    />
  );
}
