/**
 * P8-3 walkthrough of the Studio forms designer depth (SAMPLE_LAB): field library search and a
 * catalogue section reused, rules built in Logic ("required when / unless", "has any answer"),
 * validation test cases, section duplication, sample answers in the preview and the publish
 * readiness checklist. Not a test: run against a running Studio (3002); no platform host needed.
 *   OUT_DIR=/path VIDEO_DIR=/path node evidence/SF-P8-STUDIO/capture-designer-depth.mjs
 */
/* global window, document -- the init script runs in the page */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const STUDIO = process.env.STUDIO_URL ?? 'http://127.0.0.1:3002';
const OUT = process.env.OUT_DIR ?? 'test-results/path8-studio';
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
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      },
      true,
    );
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
const choose = async (locator, value) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await pause(200);
  await locator.selectOption(value);
};

await page.goto(`${STUDIO}/forms/designer`);
await page.waitForLoadState('networkidle');
await fill(page.getByLabel('Title', { exact: true }), 'Shop registration');
await fill(page.getByLabel('Form key', { exact: true }), 'lab.shop-registration.application');

await click(page.getByRole('button', { name: 'Add Radio buttons' }));
await fill(page.getByLabel('Label', { exact: true }), 'Holds a shop licence');
await fill(page.getByLabel('Data key'), 'holder');
await click(page.getByText('Paste a list of options'));
await fill(page.getByLabel('Options, one per line'), 'Yes\nNo\nApplied');
await click(page.getByRole('button', { name: 'Replace options with 3 lines' }));
await click(page.getByRole('button', { name: 'Add Short text' }));
await fill(page.getByLabel('Label', { exact: true }), 'Licence number');
await fill(page.getByLabel('Data key'), 'licence_no');
await click(page.getByRole('button', { name: 'Add Long text' }));
await fill(page.getByLabel('Label', { exact: true }), 'Why there is no licence');
await fill(page.getByLabel('Data key'), 'no_licence_reason');
await click(page.getByRole('button', { name: 'Add Email' }));
await click(page.getByRole('button', { name: 'Add Yes / no checkbox' }));
await fill(page.getByLabel('Label', { exact: true }), 'Send updates by email');
await fill(page.getByLabel('Data key'), 'updates');

// Field library: search, a canonical preset and a section reused from the catalogue.
const search = page.getByLabel('Find a field or section');
await fill(search, 'guardian');
await pause();
await click(page.getByRole('button', { name: "Add Parent or guardian's name" }));
await fill(search, 'address');
await pause();
await shot('01-palette-search-catalogue-sections');
await click(page.getByRole('button', { name: /^Reuse section Address from / }));
await pause();
await shot('02-catalogue-section-reused', { fullPage: true });
await fill(search, '');

// Logic: build "required when", "required unless" (shared condition) and "has any answer".
await click(views.getByRole('tab', { name: 'Logic' }));
const builder = page.getByTestId('rule-builder');
await choose(page.getByLabel('Rule for'), { label: 'Step 1 · “Licence number”' });
await choose(page.getByLabel('It should'), 'REQUIRE');
await choose(builder.getByLabel('Answer to'), 'holder');
await choose(builder.getByLabel('Is', { exact: true }), 'YES');
await click(builder.getByRole('button', { name: 'Add rule' }));
await choose(page.getByLabel('Rule for'), { label: 'Step 1 · “Why there is no licence”' });
await choose(page.getByLabel('It should'), 'REQUIRE_UNLESS');
await pause();
await shot('03-rule-builder-required-unless');
await click(builder.getByRole('button', { name: 'Add rule' }));
await choose(page.getByLabel('Rule for'), { label: 'Step 1 · “Send updates by email”' });
await choose(page.getByLabel('It should'), 'SHOW');
await choose(builder.getByLabel('Answer to'), 'email');
await choose(builder.getByLabel('Comparison'), 'answered');
await pause();
await shot('04-rule-builder-has-any-answer');
await click(builder.getByRole('button', { name: 'Add rule' }));
await pause();
await shot('05-logic-rules-and-matrix', { fullPage: true });

// Validation UX: summary, test cases with the exact citizen copy, canvas tags.
await click(views.getByRole('tab', { name: 'Design' }));
await click(page.getByRole('button', { name: /^Licence number, Short text/ }));
await choose(page.getByLabel('Allowed characters'), 'upper_alnum');
await page.getByTestId('field-cases').scrollIntoViewIfNeeded();
await pause();
await shot('06-validation-test-cases');
await click(page.getByRole('button', { name: 'Duplicate section Address' }));
await pause();
await shot('07-canvas-rules-validation-duplicate', { fullPage: true });
await click(page.getByRole('button', { name: 'Undo' }));

// Preview = runtime: synthetic sample answers pass every citizen check.
await click(views.getByRole('tab', { name: 'Preview' }));
await click(page.getByRole('button', { name: 'Fill with sample answers' }));
await click(page.getByRole('button', { name: 'Check whole form' }));
await pause();
await shot('08-preview-sample-answers-ready', { fullPage: true });

await click(views.getByRole('tab', { name: 'Publish' }));
await page.getByTestId('designer-readiness').scrollIntoViewIfNeeded();
await page.getByTestId('designer-readiness').hover();
await pause();
await shot('09-publish-readiness', { fullPage: true });

await context.close();
await browser.close();
console.log(`screenshots in ${OUT}${VIDEO ? `; video in ${VIDEO}` : ''}`);
