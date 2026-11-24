/**
 * World-class forms WS2 walkthrough of the Studio forms designer (SAMPLE_LAB): drag-and-drop
 * authoring, "is any of" conditions, the validation bench, the Logic view and the citizen-wizard
 * preview. Not a test: run against a running Studio (3002); no platform host is needed.
 *   OUT_DIR=/path VIDEO_DIR=/path node scripts/dev/capture-forms-designer-logic.mjs
 */
/* global window, document -- the init script runs in the page */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const STUDIO = process.env.STUDIO_URL ?? 'http://127.0.0.1:3002';
const OUT = process.env.OUT_DIR ?? 'test-results/world-class-studio-forms';
const VIDEO = process.env.VIDEO_DIR;
const SIZE = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: SIZE,
  ...(VIDEO ? { recordVideo: { dir: VIDEO, size: SIZE } } : {}),
});
// A visible pointer for the recording; it ignores events so it never blocks a click.
await context.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText =
      'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;' +
      'border-radius:50%;border:2px solid currentColor;pointer-events:none;left:-40px;top:-40px;' +
      'transition:left 60ms linear,top 60ms linear;opacity:.85';
    document.body.appendChild(dot);
    const move = (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('dragover', move, true);
  });
});
const page = await context.newPage();
const views = page.getByRole('tablist', { name: 'Designer views' });
const pause = (ms = 500) => page.waitForTimeout(ms);
const shot = async (name, opts = {}) => {
  const unstick = opts.fullPage
    ? await page.addStyleTag({ content: '.sf-header { position: static; }' })
    : null;
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  await unstick?.evaluate((el) => el.remove());
};
const click = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await pause(200);
  await locator.click();
};
const fill = async (locator, value) => {
  await click(locator);
  await locator.fill(value);
};

await page.goto(`${STUDIO}/forms/designer`);
await page.waitForLoadState('networkidle');
await fill(page.getByLabel('Title', { exact: true }), 'Trade licence application');
await fill(page.getByLabel('Form key', { exact: true }), 'lab.trade-licence.application');

// Choice field with options pasted as a list.
await click(page.getByRole('button', { name: 'Add Radio buttons' }));
await fill(page.getByLabel('Label', { exact: true }), 'Business type');
await fill(page.getByLabel('Data key'), 'business_type');
await click(page.getByText('Paste a list of options'));
await fill(page.getByLabel('Options, one per line'), 'Shop\nWorkshop\nFactory');
await click(page.getByRole('button', { name: /^Replace options with 3 lines/ }));
await pause();
await shot('01-pasted-options');

// Drag a palette item onto the canvas.
await page.getByRole('button', { name: 'Add Short text' }).hover();
await pause(200);
await page
  .getByRole('button', { name: 'Add Short text' })
  .dragTo(page.getByText('Drop here to add at the end').first());
await fill(page.getByLabel('Label', { exact: true }), 'Licence number');
await fill(page.getByLabel('Data key'), 'licence_number');
await click(page.getByText('Required', { exact: true }));
await click(page.getByText('Show or hide based on another answer'));
await page.getByLabel('Answer to').selectOption('business_type');
await page.getByLabel('Comparison').first().selectOption('any');
await pause(300);
await click(page.locator('label.ux4g-checkbox', { hasText: /^Shop$/ }));
await click(page.locator('label.ux4g-checkbox', { hasText: /^Workshop$/ }));
await click(page.locator('label.ux4g-checkbox', { hasText: /^Factory$/ }));
await page.getByLabel('Allowed characters').selectOption('upper_alnum');
await fill(page.getByLabel('Try a value'), 'ws-12');
await pause();
await shot('02-any-of-and-validation-bench');
await fill(page.getByLabel('Try a value'), 'WS12');
await pause();

await click(page.getByRole('button', { name: 'Add Long text' }));
await fill(page.getByLabel('Label', { exact: true }), 'Workshop address');
await fill(page.getByLabel('Data key'), 'workshop_address');
await click(page.getByText('Required when…'));
await page.getByLabel('When the answer to').selectOption('business_type');
await page.getByLabel('Is', { exact: true }).selectOption('FACTORY');
await pause();
await shot('03-canvas-rules', { fullPage: true });

// A second step and a field dragged onto its tab.
await click(page.getByRole('button', { name: 'Add step' }));
await fill(page.getByLabel('Name in the stepper'), 'Declaration');
await click(page.getByText('Review step (shows every answer before submit)'));
await click(page.getByRole('button', { name: 'Add Applicant declaration' }));
const steps = page.getByRole('tablist', { name: 'Steps' });
await click(steps.getByRole('tab', { name: 'Applicant' }));
await page
  .getByRole('button', { name: 'Add Email' })
  .dragTo(steps.getByRole('tab', { name: /^Declaration/ }));
await pause();
await page.getByRole('button', { name: /^Email, Email/ }).hover();
await shot('04-dropped-on-step');
await click(page.getByRole('button', { name: 'Delete Email' }));
await click(steps.getByRole('tab', { name: 'Applicant' }));

await click(views.getByRole('tab', { name: 'Logic' }));
await pause();
await shot('05-logic-view', { fullPage: true });

await click(page.getByRole('button', { name: 'Try Business type: Workshop in the preview' }));
await pause();
await click(page.getByRole('button', { name: 'Check and continue' }));
await pause();
await shot('06-preview-error-summary', { fullPage: true });
await click(page.getByText('Runtime details'));
await pause();
await shot('07-preview-runtime-details', { fullPage: true });
await fill(page.getByRole('textbox', { name: 'Licence number' }), 'WS12');
await click(page.getByRole('button', { name: 'Phone (360 px)' }));
await pause();
await shot('08-preview-phone', { fullPage: true });
await click(page.getByRole('button', { name: 'Check and continue' }));
await click(page.getByRole('button', { name: 'Check whole form' }));
await pause();
await click(page.getByRole('button', { name: 'Desktop' }));
await click(page.locator('label.ux4g-checkbox', { hasText: 'I declare that the particulars' }));
await click(page.getByRole('button', { name: 'Check whole form' }));
await pause();
await shot('09-preview-whole-form-ready', { fullPage: true });

await click(views.getByRole('tab', { name: 'Design' }));
await page.getByRole('button', { name: /^Business type, Radio buttons/ }).focus();
await page.keyboard.press('Alt+ArrowDown');
await pause();
await page.keyboard.press('Control+z');
await pause();

await context.close();
await browser.close();
console.log(`screenshots in ${OUT}${VIDEO ? `; video in ${VIDEO}` : ''}`);
