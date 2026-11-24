/**
 * P8-4 journey-level UX4G accessibility evidence on the live SAMPLE_LAB path, beyond the gallery
 * harness (tests/ux4g/forms): citizen apply for IND-SOC-002 end to end, My applications and the
 * status page, the Studio designer preview of the same form, and the officer queue and review.
 * Every screen runs the shared tests/ux4g/helpers probes: axe WCAG 2.2 A/AA at 1280 and 320 CSS px,
 * heading outline, focus visible and not obscured on every tab stop, forced colours (boundaries and
 * focus), 320 px reflow, 200% text and WCAG text spacing without loss. Keyboard-only journeys file
 * and preview a whole application without the mouse.
 * Requires `scripts/dev/platform-lab.sh up`. OTP/DigiLocker SIMULATED. SAMPLE_LAB synthetic data.
 * The file name sorts before studio-*.spec.ts on purpose: those specs publish test bindings on the
 * IND-SOC-002 offering with synthetic form pins, after which Residence drafts on the same lab
 * database fail with SF-FORM-001. Playwright queues tests in file order, so these file first.
 * Not CERTIFIED. Does not set SF_M10_UX4G_READY (SF-15 is the owner's bind).
 * REQ: DESIGN-SYSTEM.md rule 6; specs/design-system.yaml required_evidence; WCAG 2.2 AA
 * (1.3.1, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.1.1, 2.4.3, 2.4.6, 2.4.7, 2.4.11, 2.5.8, 3.3.1, 4.1.2,
 * 4.1.3).
 */
import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  applyTextSpacing,
  axeViolations,
  boundarylessControls,
  clippedText,
  focusStops,
  headingOutline,
  horizontalOverflow,
  invalidFieldWiring,
  liveRegions,
  motionUnderReducedMotion,
  resizeText,
} from '../ux4g/helpers/a11y';
import { SAMPLE_EVIDENCE_PDF, uploadEvidenceOnWizard } from './helpers/evidence-upload';

const CITIZEN = 'http://127.0.0.1:3000';
const OFFICER = 'http://127.0.0.1:3001';
const STUDIO = 'http://127.0.0.1:3002';
const APPLY = '/services/IND-SOC-002/apply';
/** Screenshots, ARIA snapshots and per-screen findings land beside the e2e results CI uploads. */
const OUT = join(import.meta.dirname, '../../test-results/e2e/ux4g-journey');
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 320, height: 640 };

const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;
const stepHeading = (page: Page) => page.locator('#sf-step-heading');
const saveAndContinue = (page: Page) => page.getByRole('button', { name: /Save & continue/i });

type Findings = Record<string, string[]>;

/**
 * Network idle, fonts loaded and every finite CSS transition/animation finished: UX4G buttons
 * transition colour for 150 ms when their variant changes, and axe must not sample mid-way.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/**
 * Full-page capture with nothing focused. The viewport grows to the document height first:
 * Chromium's full-page capture otherwise draws sticky bars at their viewport position mid-page.
 */
async function capture(page: Page, file: string): Promise<void> {
  const size = page.viewportSize() ?? DESKTOP;
  const height = await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    return document.documentElement.scrollHeight;
  });
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  await page.setViewportSize(size);
}

/**
 * Runs the full probe battery on the current screen and returns only the probes that found
 * something. Records screenshots (1280, 320, forced colours), the ARIA snapshot screen readers
 * get, live regions and reduced-motion offenders as evidence. Leaves the page at 1280 px.
 * `maxStops` bounds the focus walk on long uniform pages (the Studio template table); the
 * evidence JSON records when the walk was truncated.
 */
async function audit(page: Page, screen: string, maxStops = 200): Promise<Findings> {
  mkdirSync(OUT, { recursive: true });
  const found: Findings = {};
  const add = (probe: string, items: string[]) => {
    if (items.length > 0) found[probe] = items;
  };

  await page.setViewportSize(DESKTOP);
  await settle(page);
  add('axe-1280', await axeViolations(page));
  add('headings', await headingOutline(page));
  add('invalid-wiring', await invalidFieldWiring(page));
  const stops = await focusStops(page, maxStops);
  add('focus-walk', stops.length < 3 ? [`only ${stops.length} tab stop(s) reached`] : []);
  add(
    'focus-not-visible',
    stops.filter((s) => !s.visible).map((s) => s.label),
  );
  add(
    'focus-obscured',
    stops.filter((s) => s.obscured).map((s) => s.label),
  );
  await capture(page, `${screen}-1280.png`);
  const aria = await page.locator('body').ariaSnapshot();
  const live = await liveRegions(page);

  await resizeText(page, 200);
  add('text-200-overflow', (await horizontalOverflow(page)) > 0 ? ['horizontal scroll'] : []);
  add('text-200-clipped', await clippedText(page));
  await resizeText(page, 100);

  await page.emulateMedia({ forcedColors: 'active' });
  add('forced-colors-boundary', await boundarylessControls(page));
  add(
    'forced-colors-focus',
    (await focusStops(page, maxStops)).filter((s) => !s.visible).map((s) => s.label),
  );
  await capture(page, `${screen}-forced-colors-1280.png`);
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  const motion = await motionUnderReducedMotion(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize(PHONE);
  await settle(page);
  add('axe-320', await axeViolations(page));
  add('reflow-320-overflow', (await horizontalOverflow(page)) > 0 ? ['horizontal scroll'] : []);
  add('reflow-320-clipped', await clippedText(page));
  await capture(page, `${screen}-320.png`);
  const spacing = await applyTextSpacing(page);
  add('text-spacing-overflow', (await horizontalOverflow(page)) > 0 ? ['horizontal scroll'] : []);
  add('text-spacing-clipped', await clippedText(page));
  await spacing.evaluate((el) => el.parentNode?.removeChild(el));
  await page.setViewportSize(DESKTOP);

  writeFileSync(join(OUT, `${screen}.aria.yml`), `${aria}\n`);
  writeFileSync(
    join(OUT, `${screen}.json`),
    `${JSON.stringify(
      {
        screen,
        url: new URL(page.url()).pathname,
        tab_stops: stops.length,
        focus_walk_truncated: stops.length >= maxStops,
        findings: found,
        live_regions: live,
        reduced_motion_informational: motion,
      },
      null,
      2,
    )}\n`,
  );
  return found;
}

/** Presses Tab until `target` has focus; proves it is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `not reachable with ${max} Tab presses`).toBeFocused();
}

async function citizenSignIn(page: Page, path = APPLY): Promise<void> {
  await page.goto(`${CITIZEN}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Mobile number', { exact: true }).fill(uniqueMobile());
  await page.getByRole('button', { name: 'Get OTP' }).click();
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${path}`);
  await expect(
    stepHeading(page)
      .or(page.getByRole('heading', { level: 1 }))
      .first(),
  ).toBeVisible();
}

/** Signs in and advances the wizard to `step` (0-based); the evidence step is 2. */
async function applyAt(page: Page, step: number, upload = false): Promise<void> {
  await citizenSignIn(page);
  for (let i = 0; i < step; i++) {
    if (i === 2) await uploadEvidenceOnWizard(page);
    await saveAndContinue(page).click();
    await expect(stepHeading(page)).toContainText(`Step ${i + 2} of 4`);
  }
  if (upload) await uploadEvidenceOnWizard(page);
}

async function submitApplication(page: Page): Promise<string> {
  await applyAt(page, 3);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Submit application/i }).click();
  await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() ?? '';
}

test.describe.configure({ timeout: 180_000 });

test.describe('citizen apply journey: every screen passes the probe battery', () => {
  test('step 1 Applicant details', async ({ page }) => {
    await applyAt(page, 0);
    await expect(stepHeading(page)).toContainText('Applicant details');
    expect(await audit(page, 'citizen-apply-step-1')).toEqual({});
  });

  test('step 1 with errors: summary focused, every invalid field wired', async ({ page }) => {
    await applyAt(page, 0);
    const name = page.getByLabel('Full name (as per official record)');
    await name.fill('');
    await name.press('Enter');
    await expect(page.getByTestId('error-summary')).toBeFocused();
    await expect(page).toHaveTitle(/^Error: /);
    expect(await audit(page, 'citizen-apply-step-1-errors')).toEqual({});
  });

  test('step 2 Residence address', async ({ page }) => {
    await applyAt(page, 1);
    expect(await audit(page, 'citizen-apply-step-2')).toEqual({});
  });

  test('step 3 Supporting evidence, before and after the upload', async ({ page }) => {
    await applyAt(page, 2);
    expect(await audit(page, 'citizen-apply-step-3')).toEqual({});
    await saveAndContinue(page).click();
    await expect(page.getByTestId('error-summary')).toBeFocused();
    expect(await audit(page, 'citizen-apply-step-3-errors')).toEqual({});
    await uploadEvidenceOnWizard(page);
    expect(await audit(page, 'citizen-apply-step-3-uploaded')).toEqual({});
  });

  test('step 4 Preview and declaration, then submit without declaring', async ({ page }) => {
    await applyAt(page, 3);
    await expect(stepHeading(page)).toContainText('Preview application');
    expect(await audit(page, 'citizen-apply-preview')).toEqual({});
    await page.getByRole('button', { name: /Submit application/i }).click();
    await expect(page.getByTestId('error-summary')).toBeFocused();
    expect(await audit(page, 'citizen-apply-preview-errors')).toEqual({});
  });

  test('save and come back later: the notice takes focus', async ({ page }) => {
    await applyAt(page, 1);
    await page.getByRole('button', { name: 'Save and come back later' }).click();
    await expect(page.getByTestId('apply-notice')).toBeFocused();
    expect(await audit(page, 'citizen-apply-saved-notice')).toEqual({});
  });

  test('status page after submit, and My applications', async ({ page }) => {
    await submitApplication(page);
    expect(await audit(page, 'citizen-application-status')).toEqual({});
    await page.goto(`${CITIZEN}/certificates`);
    await expect(page.getByTestId('application-card')).toHaveCount(1);
    expect(await audit(page, 'citizen-my-applications')).toEqual({});
  });
});

test.describe('citizen apply journey: keyboard only (2.1.1, 2.4.3, 3.3.1)', () => {
  test('sign in, answer, upload evidence, declare and submit without the mouse', async ({
    page,
  }) => {
    await page.goto(`${CITIZEN}/login?next=${encodeURIComponent(APPLY)}`);
    await settle(page);
    const mobile = page.getByLabel('Mobile number', { exact: true });
    await tabTo(page, mobile);
    await page.keyboard.type(uniqueMobile());
    await page.keyboard.press('Enter');
    const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
    await expect(code).toHaveText(/^\d{6}$/);
    const digit = page.getByLabel('Digit 1 of 6');
    await tabTo(page, digit);
    await page.keyboard.type((await code.textContent()) ?? '');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${CITIZEN}${APPLY}`);

    // Step 1: replace the name, then Enter submits the step and focus moves to the next heading.
    const name = page.getByLabel('Full name (as per official record)');
    await tabTo(page, name);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('SAMPLE Keyboard Journey');
    await page.keyboard.press('Enter');
    await expect(stepHeading(page)).toBeFocused();
    await expect(stepHeading(page)).toContainText('Step 2 of 4');

    // Step 2: the stepper lets a keyboard user go back; focus returns to the step heading.
    const stepper = page.getByRole('navigation', { name: 'Application steps' });
    await tabTo(page, stepper.getByRole('button', { name: /Applicant/ }));
    await page.keyboard.press('Enter');
    await expect(stepHeading(page)).toBeFocused();
    await expect(stepHeading(page)).toContainText('Step 1 of 4');
    await expect(name).toHaveValue('SAMPLE Keyboard Journey');
    await tabTo(page, saveAndContinue(page));
    await page.keyboard.press('Enter');
    await expect(stepHeading(page)).toContainText('Step 2 of 4');
    await tabTo(page, saveAndContinue(page));
    await page.keyboard.press('Enter');
    await expect(stepHeading(page)).toBeFocused();
    await expect(stepHeading(page)).toContainText('Supporting evidence');

    // Step 3: continuing without a file puts focus on the error summary; its link reaches the
    // file input, and Space opens the chooser from the keyboard.
    await tabTo(page, saveAndContinue(page));
    await page.keyboard.press('Enter');
    const summary = page.getByTestId('error-summary');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(summary.getByRole('link')).toBeFocused();
    await page.keyboard.press('Enter');
    const file = page.getByLabel('Upload supporting evidence');
    await expect(file).toBeFocused();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (
      await chooser
    ).setFiles({
      name: 'sample-evidence.pdf',
      mimeType: 'application/pdf',
      buffer: SAMPLE_EVIDENCE_PDF,
    });
    await expect(page.getByText(/Technically accepted \(CMP-013\)/i)).toBeVisible({
      timeout: 30_000,
    });
    await tabTo(page, saveAndContinue(page));
    await page.keyboard.press('Enter');
    await expect(stepHeading(page)).toBeFocused();
    await expect(stepHeading(page)).toContainText('Preview application');

    // Preview: the declaration toggles with Space and Enter on the primary action submits.
    await expect(
      page.getByRole('definition').filter({ hasText: 'SAMPLE Keyboard Journey' }),
    ).toBeVisible();
    const declaration = page.getByRole('checkbox');
    await tabTo(page, declaration);
    await page.keyboard.press('Space');
    await expect(declaration).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: /Submit application/i }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

async function openResidenceTemplate(page: Page): Promise<void> {
  await page.goto(`${STUDIO}/forms`);
  await settle(page);
  await page.getByRole('link', { name: /^Open Residence Certificate.* in designer$/ }).click();
  await expect(page).toHaveURL(/\/forms\/designer\?template=/);
  await expect(page.getByRole('tablist', { name: 'Designer views' })).toBeVisible();
}

test.describe('Studio designer preview of the Residence form', () => {
  test('forms list, designer, and the preview at desktop, with errors, on review and at phone width', async ({
    page,
  }) => {
    await page.goto(`${STUDIO}/forms`);
    expect(await audit(page, 'studio-forms-list', 60)).toEqual({});
    await openResidenceTemplate(page);
    expect(await audit(page, 'studio-designer')).toEqual({});
    await page
      .getByRole('tablist', { name: 'Designer views' })
      .getByRole('tab', { name: 'Preview' })
      .click();
    await expect(page.locator('#preview-step-heading')).toBeVisible();
    expect(await audit(page, 'studio-preview-desktop')).toEqual({});
    await page.getByRole('button', { name: 'Clear answers' }).click();
    await page.getByRole('button', { name: 'Check whole form' }).click();
    await expect(page.getByTestId('preview-error-summary')).toBeFocused();
    expect(await audit(page, 'studio-preview-errors')).toEqual({});
    const jump = page.getByLabel('Jump to step');
    const last = await jump.locator('option').last().getAttribute('value');
    await jump.selectOption(last ?? '0');
    await expect(page.locator('#preview-step-heading')).toContainText('Preview');
    expect(await audit(page, 'studio-preview-review')).toEqual({});
    await page.getByRole('button', { name: 'Phone (360 px)' }).click();
    expect(await audit(page, 'studio-preview-phone')).toEqual({});
  });

  test('keyboard only: open the template, switch to Preview and walk the preview steps', async ({
    page,
  }) => {
    await page.goto(`${STUDIO}/forms`);
    await settle(page);
    await tabTo(
      page,
      page.getByRole('link', { name: /^Open Residence Certificate.* in designer$/ }),
      120,
    );
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/forms\/designer\?template=/);
    await settle(page);
    const preview = page
      .getByRole('tablist', { name: 'Designer views' })
      .getByRole('tab', { name: 'Preview' });
    await tabTo(
      page,
      page.getByRole('tablist', { name: 'Designer views' }).getByRole('tab').first(),
      120,
    );
    for (
      let i = 0;
      i < 6 && !(await preview.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(preview).toBeFocused();
    await page.keyboard.press('Enter');
    const heading = page.locator('#preview-step-heading');
    await expect(heading).toContainText('Step 1 of');

    await tabTo(page, page.getByRole('button', { name: 'Clear answers' }), 120);
    await page.keyboard.press('Enter');
    await tabTo(page, page.getByRole('button', { name: 'Check whole form' }), 120);
    await page.keyboard.press('Enter');
    const summary = page.getByTestId('preview-error-summary');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Tab');
    const first = summary.getByRole('link').first();
    await expect(first).toBeFocused();
    const target = await first.getAttribute('href');
    await page.keyboard.press('Enter');
    expect(target).toMatch(/^#/);
    await expect(page.locator(target ?? '#missing')).toBeFocused();
  });
});

test.describe('officer queue and review of a submitted application', () => {
  test('queue and review pass the probe battery; decision controls are keyboard reachable', async ({
    page,
    browser,
  }) => {
    const citizen = await (await browser.newContext()).newPage();
    const id = await submitApplication(citizen);
    await citizen.close();

    await page.goto(`${OFFICER}/login?next=${encodeURIComponent('/applications')}`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${OFFICER}/applications`);
    expect(await audit(page, 'officer-queue')).toEqual({});

    await page.goto(`${OFFICER}/applications/${id}`);
    await settle(page);
    expect(await audit(page, 'officer-review')).toEqual({});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, page.getByRole('button', { name: /Approve/i }).first(), 150);
  });
});
