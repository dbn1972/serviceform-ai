/**
 * UX4G forms-surface evidence suite over the shared renderer gallery. Every scene renders the
 * real @serviceform/ui-ux4g components with the governed stylesheet; citizen apply and the Studio
 * preview ship this markup. REQ: DESIGN-SYSTEM.md rules 3 and 6; specs/design-system.yaml
 * required_evidence; WCAG 2.2 AA (1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.1.1, 2.4.3, 2.4.7,
 * 2.4.11, 2.5.8, 3.3.1, 4.1.2). Not CERTIFIED; does not set SF_M10_UX4G_READY.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { GALLERY_SCENE_META as GALLERY_SCENES } from '../../../packages/ui-ux4g/gallery/scenes';
import {
  applyTextSpacing,
  axeViolations,
  boundarylessControls,
  clippedText,
  focusStops,
  horizontalOverflow,
  invalidFieldWiring,
  resizeText,
} from '../helpers/a11y';
import { SCENES_DIR } from './scenes-dir';

const HEIGHT: Record<number, number> = { 320: 640, 768: 1024, 1280: 800 };
const ERROR_SCENES = new Set(['form-errors', 'form-review', 'multilingual', 'controls']);
/** Viewports locked by visual regression per scene; 768 is where the form grid goes two-up. */
const VISUAL: Record<string, readonly number[]> = {
  'form-empty': [320, 768, 1280],
  'form-filled': [320, 1280],
  'form-errors': [320, 768, 1280],
  'form-readonly': [1280],
  'form-review': [320, 1280],
  'studio-preview': [768, 1280],
  controls: [320, 1280],
  multilingual: [320, 768, 1280],
};

async function load(page: Page, id: string, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: HEIGHT[width] ?? 800 });
  await page.setContent(readFileSync(join(SCENES_DIR, `${id}.html`), 'utf8'), {
    waitUntil: 'load',
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

for (const scene of GALLERY_SCENES) {
  test.describe(`${scene.id}: ${scene.title}`, () => {
    for (const width of [320, 1280]) {
      test(`axe WCAG 2.2 A/AA at ${width}px`, async ({ page }) => {
        await load(page, scene.id, width);
        expect(await axeViolations(page)).toEqual([]);
      });
    }

    test('reflows at 320 CSS px without horizontal scroll or clipped text (1.4.10)', async ({
      page,
    }) => {
      await load(page, scene.id, 320);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await clippedText(page)).toEqual([]);
    });

    test('text resized to 200% keeps content without loss (1.4.4)', async ({ page }) => {
      await load(page, scene.id, 1280);
      await resizeText(page, 200);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await clippedText(page)).toEqual([]);
    });

    test('WCAG text-spacing overrides lose no content (1.4.12)', async ({ page }) => {
      await load(page, scene.id, 320);
      await applyTextSpacing(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await clippedText(page)).toEqual([]);
    });

    test('every tab stop shows a focus indicator and is not obscured (2.4.7, 2.4.11)', async ({
      page,
    }) => {
      await load(page, scene.id, 1280);
      const stops = await focusStops(page);
      expect(stops.length).toBeGreaterThanOrEqual(1);
      expect(stops.filter((s) => !s.visible).map((s) => s.label)).toEqual([]);
      expect(stops.filter((s) => s.obscured).map((s) => s.label)).toEqual([]);
    });

    test('forced colours keep every control boundary', async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await load(page, scene.id, 1280);
      expect(await boundarylessControls(page)).toEqual([]);
    });

    test('forced colours keep a focus indicator on every tab stop (2.4.7)', async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await load(page, scene.id, 1280);
      const stops = await focusStops(page);
      expect(stops.filter((s) => !s.visible).map((s) => s.label)).toEqual([]);
    });

    if (ERROR_SCENES.has(scene.id)) {
      test('invalid fields are named and described by a visible error (3.3.1, 4.1.2)', async ({
        page,
      }) => {
        await load(page, scene.id, 1280);
        expect(await page.locator('[aria-invalid="true"]').count()).toBeGreaterThan(0);
        expect(await invalidFieldWiring(page)).toEqual([]);
      });
    }

    for (const width of VISUAL[scene.id] ?? []) {
      test(`visual baseline at ${width}px`, async ({ page }) => {
        await load(page, scene.id, width);
        await expect(page).toHaveScreenshot(`${scene.id}-${width}.png`, { fullPage: true });
      });
    }
  });
}

test.describe('forced colours visual baseline', () => {
  for (const id of ['form-errors', 'controls']) {
    test(`${id} at 1280px`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await load(page, id, 1280);
      await expect(page).toHaveScreenshot(`${id}-forced-colors-1280.png`, { fullPage: true });
    });
  }
});

test.describe('keyboard operation of form controls (2.1.1, 2.4.3)', () => {
  test('tab order follows reading order', async ({ page }) => {
    await load(page, 'form-empty', 1280);
    const domOrder = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      )
        // A radio group is one tab stop: its checked radio, or its first radio when none is checked.
        .filter((el, i, all) => {
          if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return true;
          const group = all.filter(
            (o) => o instanceof HTMLInputElement && o.type === 'radio' && o.name === el.name,
          );
          const checked = group.find((o) => (o as HTMLInputElement).checked);
          return el === (checked ?? group[0]) && all.indexOf(el) === i;
        })
        .map((el) => el.id || el.textContent?.trim() || el.tagName),
    );
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Date inputs expose day/month/year segments as consecutive stops on one element.
    const tabOrder: string[] = [];
    for (let i = 0; i < domOrder.length * 4 && tabOrder.length < domOrder.length; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el.id || el.textContent?.trim() || el.tagName;
      });
      if (tabOrder[tabOrder.length - 1] !== id) tabOrder.push(id);
    }
    expect(tabOrder).toEqual(domOrder);
  });

  test('skip link is the first stop and moves focus to main', async ({ page }) => {
    await load(page, 'form-empty', 1280);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('radio group: one tab stop, arrow keys move the selection', async ({ page }) => {
    await load(page, 'form-empty', 1280);
    const female = page.getByRole('radio', { name: 'Female' });
    await female.focus();
    await page.keyboard.press('Space');
    await expect(female).toBeChecked();
    await page.keyboard.press('ArrowDown');
    const male = page.getByRole('radio', { name: 'Male', exact: true });
    await expect(male).toBeChecked();
    await expect(male).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: 'Transgender / other' })).not.toBeFocused();
  });

  test('checkbox and switch toggle with Space; text inputs accept typing', async ({ page }) => {
    await load(page, 'controls', 1280);
    const box = page.getByRole('checkbox', { name: 'Unchecked checkbox' });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    const name = page.getByRole('textbox', { name: 'Size m' });
    await name.fill('');
    await name.pressSequentially('ok');
    await expect(name).toHaveValue('ok');
  });

  test('disabled controls are skipped and read-only scene exposes disabled state', async ({
    page,
  }) => {
    await load(page, 'form-readonly', 1280);
    const fields = page.locator('input, select, textarea');
    const count = await fields.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i++) await expect(fields.nth(i)).toBeDisabled();
  });
});

test.describe('accessible names and descriptions (1.3.1, 4.1.2)', () => {
  test('every form control in every scene has an accessible name', async ({ page }) => {
    for (const scene of GALLERY_SCENES) {
      await load(page, scene.id, 1280);
      const unnamed = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea, button'))
          .filter((el) => {
            const labelled = el.id && document.querySelector(`label[for="${el.id}"]`);
            const wrapped = el.closest('label');
            return !(
              labelled ||
              wrapped ||
              el.getAttribute('aria-label') ||
              el.getAttribute('aria-labelledby') ||
              (el.tagName === 'BUTTON' && el.textContent?.trim())
            );
          })
          .map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
      );
      expect(unnamed, scene.id).toEqual([]);
    }
  });

  test('hints and errors are announced with their field', async ({ page }) => {
    await load(page, 'form-errors', 1280);
    await expect(page.getByLabel('PIN code')).toHaveAccessibleDescription(
      'Error: PIN code must be 6 digits',
    );
    await expect(page.getByRole('combobox', { name: 'District' })).toHaveAccessibleDescription(
      'Error: Select your district',
    );
    await load(page, 'form-empty', 1280);
    await expect(page.getByLabel('PIN code')).toHaveAccessibleDescription('6 digits');
  });

  test('optional fields say so in their name; required fields carry required', async ({ page }) => {
    await load(page, 'form-empty', 1280);
    await expect(page.getByLabel('Email address (optional)')).toBeVisible();
    await expect(page.getByLabel('Full name (as per official record)')).toHaveAttribute(
      'required',
      '',
    );
  });
});

test.describe('probe self-tests: each probe fails on a seeded violation', () => {
  test('focus probe reports stops without an indicator', async ({ page }) => {
    await load(page, 'form-review', 1280);
    await page.addStyleTag({
      content:
        '*, *:focus, *:focus-visible, *:focus-within { outline: none !important; box-shadow: none !important;' +
        ' border-color: transparent !important; transition: none !important; }',
    });
    const stops = await focusStops(page);
    expect(stops.some((s) => !s.visible)).toBe(true);
  });

  test('reflow, clipping, wiring and boundary probes report seeded defects', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent(
      '<html lang="en"><body><main>' +
        '<div style="width:2000px">wide</div>' +
        '<div style="height:4px;overflow:hidden">clipped text that cannot fit</div>' +
        '<input aria-invalid="true" aria-label="x" />' +
        '<div class="ux4g-input" style="border:none"></div>' +
        '</main></body></html>',
    );
    expect(await horizontalOverflow(page)).toBeGreaterThan(0);
    expect(await clippedText(page)).not.toEqual([]);
    expect(await invalidFieldWiring(page)).not.toEqual([]);
    expect(await boundarylessControls(page)).not.toEqual([]);
  });
});

/** Computed UX4G token values for the controls a form step renders, keyed by role. */
async function styleSignature(
  page: Page,
  root: string,
): Promise<Record<string, Record<string, string>>> {
  return page.evaluate((rootSel) => {
    const props = [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'background-color',
      'border-top-width',
      'border-top-style',
      'border-top-color',
      'border-radius',
      'padding-top',
      'padding-left',
      'min-height',
      'gap',
      'row-gap',
      'column-gap',
    ];
    const roles: Record<string, string> = {
      field: '.ux4g-input',
      input: '.ux4g-input-input',
      label: '.ux4g-label-m-default',
      helper: '.ux4g-input-helper',
      textarea: 'textarea.ux4g-textarea',
      select: 'select.ux4g-input-input',
      grid: '.sf-form-grid',
      section: '.sf-form-section',
      sectionHeading: '.sf-form-section h3',
      optional: '.sf-label-optional',
    };
    const scope = document.querySelectorAll(rootSel);
    const host = scope[scope.length - 1] ?? document.body;
    const out: Record<string, Record<string, string>> = {};
    for (const [role, sel] of Object.entries(roles)) {
      const el = host.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[role] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  }, root);
}

test.describe('token lock and preview = runtime', () => {
  test('Studio preview renders form controls with the same UX4G tokens as the citizen runtime', async ({
    page,
  }) => {
    await load(page, 'form-empty', 1280);
    const runtime = await styleSignature(page, '.sf-step-panel');
    await load(page, 'studio-preview', 1280);
    const preview = await styleSignature(page, '.sf-designer-device .sf-step-panel');
    expect(Object.keys(runtime).length).toBeGreaterThan(6);
    expect(preview).toEqual(runtime);
  });

  test('form control token values match the locked signature', async ({ page }) => {
    await load(page, 'form-empty', 1280);
    const steady = await styleSignature(page, '.sf-step-panel');
    await load(page, 'form-errors', 1280);
    const error = await styleSignature(page, '.sf-step-panel');
    expect(JSON.stringify({ steady, error }, null, 2)).toMatchSnapshot('form-token-lock.txt');
  });
});
