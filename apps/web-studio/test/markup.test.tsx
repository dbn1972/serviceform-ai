import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/page';
import NewServicePage from '../app/services/new/page';
import { StudioNav } from '../components/StudioNav';

describe('web-studio markup (UX4G)', () => {
  it('keeps the shell heading and landmarks', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('data-surface="service_studio"');
    expect(html).toContain('>Service Design Studio</h1>');
    expect(html).toContain('sf-skip-link');
    expect(html).toContain('ux4g-navbar');
  });

  it('groups overflow destinations under More (Wave 1 nav)', () => {
    const html = renderToStaticMarkup(<StudioNav />);
    expect(html).toContain('>More</summary>');
    expect(html).toContain('sf-studio-nav-more-menu');
    expect(html).toContain('href="/metadata"');
    expect(html).toContain('href="/publication"');
    expect(html).toContain('href="/interop"');
    expect(html).toContain('href="/fees"');
    expect(html).toContain('href="/credentials"');
    // Overflow destinations live under More, not as peer primary <li> links.
    expect(html).toMatch(/sf-studio-nav-more-menu[\s\S]*href="\/fees"[\s\S]*href="\/credentials"/);
  });

  it('uses button hierarchy on home instead of peer TextLink rows', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('ux4g-btn-primary ux4g-btn-m');
    expect(html).toContain('Browse templates');
    expect(html).toContain('Open forms designer');
    expect(html).not.toContain('CERTIFIED=false');
    expect(html).not.toContain('G6=false');
  });

  it('offers a primary CTA path on new-service', () => {
    const html = renderToStaticMarkup(<NewServicePage />);
    expect(html).toContain('Start from Residence template');
    expect(html).toContain('ux4g-btn-primary ux4g-btn-m');
    expect(html).toContain('Open Metadata designer');
    expect(html).toContain('Open Publication desk');
  });

  it('publication desk copy stresses maker-checker separation (WS6)', async () => {
    const PublicationPage = (await import('../app/publication/page')).default;
    const html = renderToStaticMarkup(await PublicationPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Maker-checker');
    expect(html).toContain('Maker-checker publication desk');
    expect(html).toContain('CMP-051 records maker and checker separately');
  });
});
