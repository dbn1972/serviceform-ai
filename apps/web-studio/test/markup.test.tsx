import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/page';
import { StudioNav } from '../components/StudioNav';

describe('web-studio markup (UX4G)', () => {
  it('keeps the shell heading and landmarks', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('data-surface="service_studio"');
    expect(html).toContain('>Service Design Studio</h1>');
    expect(html).toContain('sf-skip-link');
    expect(html).toContain('ux4g-navbar');
  });

  it('exposes metadata and publication destinations', () => {
    const html = renderToStaticMarkup(<StudioNav />);
    expect(html).toContain('href="/metadata"');
    expect(html).toContain('href="/publication"');
    expect(html).toContain('href="/interop"');
  });

  it('publication desk copy stresses maker-checker separation (WS6)', async () => {
    const PublicationPage = (await import('../app/publication/page')).default;
    const html = renderToStaticMarkup(await PublicationPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Maker-checker');
    expect(html).toContain('Maker-checker publication desk');
    expect(html).toContain('CMP-051 records maker and checker separately');
  });
});
