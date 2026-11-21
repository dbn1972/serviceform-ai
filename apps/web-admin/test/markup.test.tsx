import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BindingsPage from '../app/bindings/page';
import HomePage from '../app/page';
import { AdminNav } from '../components/AdminNav';

describe('web-admin markup (UX4G)', () => {
  it('keeps the shell heading and landmarks', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('data-surface="tenant_admin"');
    expect(html).toContain('>Administration</h1>');
    expect(html).toContain('sf-skip-link');
  });

  it('exposes binding and review destinations', () => {
    const html = renderToStaticMarkup(<AdminNav />);
    expect(html).toContain('href="/bindings"');
    expect(html).toContain('href="/reviews"');
    expect(html).toContain('href="/branding"');
    expect(html).toContain('href="/analytics"');
    expect(html).toContain('href="/discovery"');
  });

  it('bindings page includes reusable jurisdiction scope desk for any offering', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('Jurisdiction scope (states / districts / municipalities)');
    expect(html).toContain('Allowed states (LGD codes, one per line)');
    expect(html).toContain('Allowed districts (LGD codes, one per line)');
    expect(html).toContain('Allowed municipalities / ULBs (LGD local-body codes, one per line)');
    expect(html).toContain('Catalogue id (e.g. IND-CIV-001, IND-ULB-007)');
  });

  it('bindings page exposes SAMPLE_LAB eng seal prove control (SF-60)', () => {
    const html = renderToStaticMarkup(<BindingsPage />);
    expect(html).toContain('Prove lab eng seal');
  });
});
