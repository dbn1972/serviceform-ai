import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
  });
});
