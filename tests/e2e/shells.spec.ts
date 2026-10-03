import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SURFACES } from './playwright.config';

// REQ: DESIGN-SYSTEM.md rule 6; TESTING.md accessibility + responsive/reflow; SECURITY.md headers.
for (const s of SURFACES) {
  const base = `http://127.0.0.1:${s.port}`;

  test.describe(`${s.app} shell`, () => {
    test('serves the page with landmarks and a level-one heading', async ({ page }) => {
      const res = await page.goto(base);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(`ServiceForm AI - ${s.title}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.title);
      await expect(page.locator(`[data-surface="${s.surface}"]`)).toHaveCount(1);
    });

    test('has no automatically detectable WCAG 2.1 A/AA violations', async ({ page }) => {
      await page.goto(base);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });

    test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
      await page.goto(base);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await expect(skip).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
    });

    test('reflows at 320 CSS px without horizontal scrolling (WCAG 1.4.10)', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(base);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('sends security headers and a health endpoint', async ({ request }) => {
      const res = await request.get(base);
      const h = res.headers();
      expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-powered-by']).toBeUndefined();
      const health = await request.get(`${base}/api/health`);
      expect(await health.json()).toEqual({ status: 'ok' });
    });
  });
}
