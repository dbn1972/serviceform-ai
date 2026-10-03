import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, MAIN_CONTENT_ID } from '../src/index';

describe('AppShell (REQ: DESIGN-SYSTEM.md rule 6, TESTING.md UX4G verification)', () => {
  const html = renderToStaticMarkup(
    <AppShell surface="citizen_web" title="Citizen">
      <h1>Heading</h1>
    </AppShell>,
  );

  it('renders banner, main and contentinfo landmarks', () => {
    expect(html).toMatch(/<header[^>]*>/);
    expect(html).toContain(`<main id="${MAIN_CONTENT_ID}"`);
    expect(html).toMatch(/<footer[^>]*>/);
  });

  it('starts with a skip link targeting main content', () => {
    expect(html.indexOf('sf-skip-link')).toBeLessThan(html.indexOf('<header'));
    expect(html).toContain(`href="#${MAIN_CONTENT_ID}"`);
  });

  it('marks the surface for theming and tests', () => {
    expect(html).toContain('data-surface="citizen_web"');
  });
});
