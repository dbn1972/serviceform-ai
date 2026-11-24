/**
 * Path-to-8 P8-2 citizen apply polish: one-off submission confirmation (memory only, never a
 * decision), compact apply header. SAMPLE_LAB. Not CERTIFIED. G6=false.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CitizenPageHeader } from '../components/CitizenPageHeader';
import { SubmissionConfirmation } from '../components/SubmissionConfirmation';
import { forgetJustSubmitted, markJustSubmitted, wasJustSubmitted } from '../lib/just-submitted';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = '11111111-2222-4333-8444-555555555555';

describe('just-submitted hand-off', () => {
  it('greets only the application submitted in this tab, until it is forgotten', () => {
    expect(wasJustSubmitted(ID)).toBe(false);
    markJustSubmitted(ID);
    expect(wasJustSubmitted(ID)).toBe(true);
    expect(wasJustSubmitted('22222222-2222-4333-8444-555555555555')).toBe(false);
    forgetJustSubmitted(ID);
    expect(wasJustSubmitted(ID)).toBe(false);
  });

  it('holds nothing in browser storage (no client PII store)', () => {
    for (const file of [
      'lib/just-submitted.ts',
      'components/SubmissionConfirmation.tsx',
      'components/MetadataApplyForm.tsx',
      'components/CertificateDetail.tsx',
    ]) {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });
});

describe('SubmissionConfirmation', () => {
  it('states the reference and what happens next, and never claims a decision', () => {
    const html = renderToStaticMarkup(
      <SubmissionConfirmation reference="11111111" status="SUBMITTED" />,
    );
    expect(html).toContain('Application submitted');
    expect(html).toContain('Your reference number');
    expect(html).toContain('>11111111<');
    expect(html).toContain('Submitting is not a decision');
    expect(html).toContain('DigiLocker (SIMULATED)');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toMatch(/approved|eligible|granted/i);
    expect(html).not.toMatch(/style=/);
  });

  it('asks for the fee first when the application waits for payment', () => {
    const html = renderToStaticMarkup(
      <SubmissionConfirmation reference="11111111" status="PAYMENT_REQUIRED" />,
    );
    expect(html).toContain('Application received');
    expect(html).toContain('Pay the fee');
    expect(html).toContain('SIMULATED in SAMPLE_LAB');
  });
});

describe('CitizenPageHeader', () => {
  it('compact task header keeps one h1 and the breadcrumb, with a smaller title', () => {
    const html = renderToStaticMarkup(
      <CitizenPageHeader
        compact
        title="Apply — Sample service"
        crumbs={[{ href: '/services', label: 'Services' }, { label: 'Apply' }]}
        meta={<span className="ux4g-tag-tonal-neutral">SAMPLE_LAB</span>}
      />,
    );
    expect(html).toContain('sf-citizen-hero sf-citizen-hero-compact');
    expect(html).toContain('<h1 class="ux4g-heading-l-strong">Apply — Sample service</h1>');
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Breadcrumb"');
    const full = renderToStaticMarkup(<CitizenPageHeader title="Services" />);
    expect(full).toContain('<h1 class="ux4g-heading-2xl-strong">Services</h1>');
    expect(full).not.toContain('sf-citizen-hero-compact');
  });
});
