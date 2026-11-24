/**
 * Renders every UX4G forms-gallery scene to static HTML for the Playwright harness. Runs under
 * Vitest because Playwright's loader compiles TSX for component testing, which React's server
 * renderer cannot consume.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GALLERY_SCENES, renderScene } from '../../../packages/ui-ux4g/gallery/forms-gallery';
import { SCENES_DIR } from './scenes-dir';

describe('UX4G forms gallery render', () => {
  mkdirSync(SCENES_DIR, { recursive: true });

  it.each(GALLERY_SCENES.map((s) => s.id))(
    'renders %s with landmarks and UX4G classes only',
    (id) => {
      const html = renderScene(id);
      const body = html.slice(html.indexOf('<body>'));
      expect(body).toContain('<main id="main-content"');
      expect(body).toContain('class="sf-skip-link"');
      expect(body).not.toMatch(/Mui|form-control|json-forms-default|style="/);
      writeFileSync(join(SCENES_DIR, `${id}.html`), html, 'utf8');
    },
  );
});
