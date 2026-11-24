/**
 * Path-to-8 P8-2: citizen apply polish on the SAMPLE_LAB platform path. Honest answer progress,
 * phone first screen and thumb-zone actions, focus never hidden by the action bar, steps flagged
 * after a refused submit, save-failure recovery, one-off submission confirmation, reduced motion.
 * Requires `scripts/dev/platform-lab.sh up`. OTP/DigiLocker SIMULATED. Not CERTIFIED. G6=false.
 * REQ: DESIGN-SYSTEM.md rule 6, WCAG 2.1 AA + 2.4.11 + 2.3.3 (reduced motion), CCR-M10-002.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { uploadEvidenceOnWizard } from './helpers/evidence-upload';

const CITIZEN = 'http://127.0.0.1:3000';
const APPLY = '/services/IND-SOC-002/apply';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const uniqueMobile = () => `9${randomInt(100_000_000, 1_000_000_000)}`;

async function signIn(page: Page): Promise<void> {
  await page.goto(`${CITIZEN}/login?next=${encodeURIComponent(APPLY)}`);
  await page.getByLabel('Mobile number', { exact: true }).fill(uniqueMobile());
  await page.getByRole('button', { name: 'Get OTP' }).click();
  const code = page.getByTestId('simulated-sms').locator('.sf-auth-sms-code');
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel('Digit 1 of 6').fill((await code.textContent()) ?? '');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(`${CITIZEN}${APPLY}`);
  await expect(page.locator('#sf-step-heading')).toBeVisible();
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    label,
  ).toEqual([]);
}

type Progress = { value: number; max: number; text: string };

async function progress(page: Page): Promise<Progress> {
  const box = page.getByTestId('form-progress');
  const bar = box.locator('progress');
  return {
    value: Number(await bar.getAttribute('value')),
    max: Number(await bar.getAttribute('max')),
    text: (await box.textContent()) ?? '',
  };
}

const stepHeading = (page: Page) => page.locator('#sf-step-heading');
const continueButton = (page: Page) => page.getByRole('button', { name: /Save & continue/i });
const stepButtons = (page: Page) =>
  page.getByRole('navigation', { name: 'Application steps' }).getByRole('button');

test.describe('answer progress', () => {
  test.describe.configure({ timeout: 120_000 });

  test('counts required answers honestly: a prefilled evidence name is not an upload', async ({
    page,
  }) => {
    await signIn(page);
    const start = await progress(page);
    expect(start.max).toBeGreaterThan(1);
    expect(start.value).toBe(start.max - 1);
    expect(start.text).toContain(`${start.value} of ${start.max} required answers`);
    expect(start.text).toContain(`${Math.floor((start.value / start.max) * 100)}% complete`);

    const name = page.getByLabel('Full name (as per official record)');
    await name.fill('');
    await expect.poll(async () => (await progress(page)).value).toBe(start.value - 1);
    await name.fill('SAMPLE Progress Citizen');
    await expect.poll(async () => (await progress(page)).value).toBe(start.value);

    await continueButton(page).click();
    await continueButton(page).click();
    await expect(stepHeading(page)).toContainText('Supporting evidence');
    await uploadEvidenceOnWizard(page);
    await expect.poll(async () => (await progress(page)).value).toBe(start.max);
    await expect(page.getByTestId('form-progress')).toContainText('100% complete');
    await expectNoAxeViolations(page, 'evidence accepted, progress complete');
  });
});

test.describe('phone: first screen, thumb zone and focus (390 x 844)', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 390, height: 844 } });

  test('the first question is on the first screen, above a sticky action bar in the thumb zone', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByTestId('form-progress')).toBeVisible();
    const input = await page.getByLabel('Full name (as per official record)').boundingBox();
    const bar = await page.locator('.sf-wizard-actions').boundingBox();
    expect(input && bar).toBeTruthy();
    if (!input || !bar) return;
    expect(input.y).toBeGreaterThanOrEqual(0);
    expect(input.y + input.height).toBeLessThanOrEqual(bar.y);
    expect(Math.round(bar.y + bar.height)).toBe(844);
    expect(bar.height).toBeLessThanOrEqual(120);
    const primary = await continueButton(page).boundingBox();
    expect(primary?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(primary?.width ?? 0).toBeGreaterThan(390 / 2);
    await expectNoAxeViolations(page, 'phone step 1');
  });

  test('keyboard focus is never hidden behind the sticky bar (WCAG 2.4.11)', async ({ page }) => {
    await signIn(page);
    await continueButton(page).click();
    await expect(stepHeading(page)).toBeFocused();
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const bar = document.querySelector('.sf-wizard-actions');
        if (!el || !bar || !el.closest('.sf-step-panel, .sf-wizard-actions')) return null;
        const r = el.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        return {
          id: el.id || el.textContent?.trim().slice(0, 30) || el.tagName,
          inBar: bar.contains(el),
          top: r.top,
          bottom: r.bottom,
          barTop: b.top,
        };
      });
      if (!stop || stop.inBar) continue;
      seen.push(stop.id);
      expect(stop.top, stop.id).toBeGreaterThanOrEqual(0);
      expect(stop.bottom, stop.id).toBeLessThanOrEqual(stop.barTop + 1);
    }
    expect(seen.length).toBeGreaterThan(4);
  });
});

test.describe('error recovery', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a refused submit flags every step that still needs attention until it is fixed', async ({
    page,
  }) => {
    await signIn(page);
    await continueButton(page).click();
    await continueButton(page).click();
    await uploadEvidenceOnWizard(page);
    await continueButton(page).click();
    await expect(stepHeading(page)).toContainText('Preview application');

    // Break one answer on step 1 and one on step 2 through the stepper (no step validation).
    await stepButtons(page).nth(0).click();
    await page.getByLabel('Full name (as per official record)').fill('');
    await stepButtons(page).nth(1).click();
    await page.getByLabel('PIN code').fill('');
    await stepButtons(page).nth(3).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Submit application/i }).click();

    await expect(page.getByTestId('error-summary')).toBeFocused();
    await expect(stepHeading(page)).toContainText('Applicant details');
    const residence = stepButtons(page).nth(1);
    await expect(residence).toContainText('Needs attention');
    await expect(page.locator('.sf-stepper-attention')).toHaveCount(1);
    await expectNoAxeViolations(page, 'refused submit with a flagged step');

    await page.getByLabel('Full name (as per official record)').fill('SAMPLE Recovered Citizen');
    await continueButton(page).click();
    await expect(stepHeading(page)).toContainText('Residence address');
    await page.getByLabel('PIN code').fill('751001');
    await continueButton(page).click();
    await expect(page.locator('.sf-stepper-attention')).toHaveCount(0);
    await expect(stepButtons(page).nth(1)).toContainText('Completed');
  });

  test('a failed autosave says so, keeps the answers and recovers with "Try saving again"', async ({
    page,
  }) => {
    await signIn(page);
    await page.route('**/api/portal/drafts**', (route) => route.abort('internetdisconnected'));
    await page.getByLabel('Full name (as per official record)').fill('SAMPLE Offline Citizen');
    await continueButton(page).click();
    const status = page.getByTestId('save-status');
    await expect(status).toContainText('Not saved just now. Your answers are still on this page.');
    const retry = page.getByRole('button', { name: 'Try saving again' });
    await expect(retry).toBeVisible();
    await expectNoAxeViolations(page, 'save failed');

    await page.unroute('**/api/portal/drafts**');
    await retry.click();
    await expect(status).toContainText(/Saved/);
    await expect(retry).toHaveCount(0);
    await expect(page).toHaveURL(/\/apply\?draft=[0-9a-f-]{36}$/);
    await stepButtons(page).nth(0).click();
    await expect(page.getByLabel('Full name (as per official record)')).toHaveValue(
      'SAMPLE Offline Citizen',
    );
  });
});

test.describe('submission confirmation', () => {
  test.describe.configure({ timeout: 120_000 });

  test('after submit the status page confirms once, with the reference, focused for screen readers', async ({
    page,
  }) => {
    await signIn(page);
    await continueButton(page).click();
    await continueButton(page).click();
    await uploadEvidenceOnWizard(page);
    await continueButton(page).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Submit application/i }).click();

    await expect(page).toHaveURL(/\/certificates\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop() ?? '';
    const confirmation = page.getByTestId('submission-confirmation');
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('heading', { name: 'Application submitted' }),
    ).toBeFocused();
    await expect(page.getByTestId('confirmation-reference')).toHaveText(
      id.slice(0, 8).toUpperCase(),
    );
    await expect(confirmation).toContainText('Submitting is not a decision');
    await expect(page.getByText(/Awaiting officer decision/i)).toBeVisible();
    await expectNoAxeViolations(page, 'submission confirmation');

    await page.reload();
    await expect(page.getByText(/Awaiting officer decision/i)).toBeVisible();
    await expect(page.getByTestId('submission-confirmation')).toHaveCount(0);
  });
});

test.describe('motion respects the reduced-motion preference (WCAG 2.3.3)', () => {
  test.describe.configure({ timeout: 90_000 });

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`step change with prefers-reduced-motion: ${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await signIn(page);
      await continueButton(page).click();
      await expect(stepHeading(page)).toContainText('Residence address');
      const body = page.getByTestId('step-body');
      await expect(body).toHaveClass(/sf-step-enter-forward/);
      const animation = await body.evaluate((el) => getComputedStyle(el).animationName);
      const transition = await page
        .locator('.sf-stepper-index')
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      if (reducedMotion === 'reduce') {
        expect(animation).toBe('none');
        expect(transition).toBe('0s');
      } else {
        expect(animation).toBe('sf-step-in-forward');
        expect(transition).not.toBe('0s');
      }
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(stepHeading(page)).toContainText('Applicant details');
      await expect(body).toHaveClass(/sf-step-enter-back/);
    });
  }
});
