import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FeesPage from '../app/fees/page';
import SlaPage from '../app/sla/page';
import EvidencePage from '../app/evidence/page';
import CredentialsPage from '../app/credentials/page';
import { StudioNav } from '../components/StudioNav';
import { FeeDesigner } from '../components/fees/FeeDesigner';
import { SlaDesigner } from '../components/sla/SlaDesigner';
import { EvidenceDesigner } from '../components/evidence/EvidenceDesigner';
import { CredentialDesigner } from '../components/credential/CredentialDesigner';

// REQ: SF-59 Studio Fee/SLA/Evidence/Credential designers (UX4G landing + designer shells).
describe('Studio meta-kind designers', () => {
  it('exposes Fees, SLA, Evidence and Credentials in the nav', () => {
    const html = renderToStaticMarkup(<StudioNav />);
    expect(html).toContain('href="/fees"');
    expect(html).toContain('href="/sla"');
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/credentials"');
  });

  it('offers blank, draft and template starting points on each landing page', () => {
    expect(renderToStaticMarkup(<FeesPage />)).toContain('>Fee designer</h1>');
    expect(renderToStaticMarkup(<FeesPage />)).toContain(
      'href="/fees/designer?template=ind-edu-004-dummy"',
    );
    expect(renderToStaticMarkup(<FeesPage />)).toContain(
      'href="/fees/designer?template=ind-soc-031-dummy"',
    );
    expect(renderToStaticMarkup(<SlaPage />)).toContain('>SLA designer</h1>');
    expect(renderToStaticMarkup(<SlaPage />)).toContain(
      'href="/sla/designer?template=ind-soc-002-sla"',
    );
    expect(renderToStaticMarkup(<SlaPage />)).toContain(
      'href="/sla/designer?template=ind-soc-031-sla"',
    );
    expect(renderToStaticMarkup(<EvidencePage />)).toContain('>Evidence designer</h1>');
    expect(renderToStaticMarkup(<EvidencePage />)).toContain(
      'href="/evidence/designer?template=ind-soc-031-evidence"',
    );
    expect(renderToStaticMarkup(<CredentialsPage />)).toContain('>Credential designer</h1>');
    expect(renderToStaticMarkup(<CredentialsPage />)).toContain(
      'href="/credentials/designer?template=ind-soc-002-credential"',
    );
    expect(renderToStaticMarkup(<CredentialsPage />)).toContain(
      'href="/credentials/designer?template=ind-soc-031-credential"',
    );
  });

  it('renders SAMPLE_LAB template designers with checks and not-statutory banners', () => {
    const fee = renderToStaticMarkup(
      <FeeDesigner source={{ kind: 'template', id: 'ind-edu-004-dummy' }} />,
    );
    expect(fee).toContain('SAMPLE_LAB DUMMY · Transfer Certificate fee');
    expect(fee).toContain('Not statutory');
    expect(fee).toContain('999');
    expect(fee).toContain('CERTIFIED=false');

    const sla = renderToStaticMarkup(
      <SlaDesigner source={{ kind: 'template', id: 'ind-soc-002-sla' }} />,
    );
    expect(sla).toContain('Residence Certificate SLA');
    expect(sla).toContain('P10D');

    const evd = renderToStaticMarkup(
      <EvidenceDesigner source={{ kind: 'template', id: 'ind-soc-002-evidence' }} />,
    );
    expect(evd).toContain('proof_of_address');
    expect(evd).toContain('SAMPLE_LAB DUMMY');

    const cred = renderToStaticMarkup(
      <CredentialDesigner source={{ kind: 'template', id: 'ind-soc-002-credential' }} />,
    );
    expect(cred).toContain('SAMPLE_LAB_IND_SOC_002_RESIDENT');
    expect(cred).toContain('DigiLocker');

    const incomeFee = renderToStaticMarkup(
      <FeeDesigner source={{ kind: 'template', id: 'ind-soc-031-dummy' }} />,
    );
    expect(incomeFee).toContain('SAMPLE_LAB DUMMY · Income Certificate fee');
    expect(incomeFee).toContain('999');
    expect(incomeFee).toContain('Not statutory');
  });
});
